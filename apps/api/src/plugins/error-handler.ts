import { getPgError, PgErrorCode } from "@ledgerly/db";
import type { Problem } from "@ledgerly/shared";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";
import { AppError } from "../lib/errors.js";

const PROBLEM_BASE = "https://docs.ledgerly.app/problems/";

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  problem: Omit<Problem, "type" | "instance" | "requestId">,
) {
  const body: Problem = {
    type: `${PROBLEM_BASE}${problem.code}`,
    instance: request.url.split("?")[0],
    requestId: request.id,
    ...problem,
  };
  return reply.status(problem.status).type("application/problem+json").send(body);
}

/**
 * The ONE place where errors become HTTP responses.
 *
 *  - Validation errors  → 400 with a list of field errors
 *  - AppError           → its own status/code (404, 409, 422…)
 *  - Postgres errors    → mapped by SQLSTATE (unique violation → 409…)
 *  - Anything else      → 500 with NO internal details (logged with the request id)
 *
 * Centralising this guarantees every error has the same shape, and that stack
 * traces or SQL never leak to clients — a common real-world security finding.
 */
export const errorHandlerPlugin = fp(
  async (app: FastifyInstance) => {
    app.setErrorHandler((error: FastifyError, request, reply) => {
      if (hasZodFastifySchemaValidationErrors(error)) {
        return send(request, reply, {
          status: 400,
          code: "validation_failed",
          title: "Invalid request",
          detail: "One or more fields are invalid.",
          errors: error.validation.map((issue) => ({
            path: [
              error.validationContext,
              ...String(issue.instancePath).split("/").filter(Boolean),
            ].join("."),
            message: issue.message ?? "Invalid value",
          })),
        });
      }

      if (error instanceof AppError) {
        if (error.headers) reply.headers(error.headers);
        return send(request, reply, {
          status: error.status,
          code: error.code,
          title: error.title,
          detail: error.detail,
          errors: error.errors,
        });
      }

      const pgError = getPgError(error);
      if (pgError?.code === PgErrorCode.uniqueViolation) {
        return send(request, reply, {
          status: 409,
          code: "conflict",
          title: "Conflict",
          detail: "A record with these values already exists.",
        });
      }
      if (
        pgError?.code === PgErrorCode.foreignKeyViolation ||
        pgError?.code === PgErrorCode.checkViolation
      ) {
        request.log.warn({ err: error }, "Database constraint rejected a request");
        return send(request, reply, {
          status: 422,
          code: "constraint_violation",
          title: "Unprocessable request",
          detail: "The request breaks a data integrity rule.",
        });
      }

      if (isResponseSerializationError(error)) {
        // Our own response didn't match its declared schema: a bug on OUR side.
        request.log.error({ err: error }, "Response failed schema validation");
      } else if (typeof error.statusCode === "number" && error.statusCode < 500) {
        // Framework-level client errors: malformed JSON, body too large, wrong content type…
        return send(request, reply, {
          status: error.statusCode,
          code: (error.code ?? "bad_request").toLowerCase(),
          title: "Bad request",
          detail: error.message,
        });
      } else {
        request.log.error({ err: error }, "Unhandled error");
      }

      return send(request, reply, {
        status: 500,
        code: "internal_error",
        title: "Internal server error",
        detail: "Something went wrong on our side. Quote the request id when contacting support.",
      });
    });

    app.setNotFoundHandler((request, reply) =>
      send(request, reply, {
        status: 404,
        code: "route_not_found",
        title: "Not found",
        detail: `No route for ${request.method} ${request.url.split("?")[0]}`,
      }),
    );
  },
  { name: "error-handler" },
);
