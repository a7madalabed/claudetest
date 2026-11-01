import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import type { Database } from "@ledgerly/db";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "./config/env.js";
import { accountRoutes } from "./modules/accounts/accounts.routes.js";
import { categoryRoutes } from "./modules/categories/categories.routes.js";
import { householdRoutes, meRoutes } from "./modules/households/households.routes.js";
import { householdScope } from "./modules/households/scope.js";
import { reportRoutes } from "./modules/reports/reports.routes.js";
import { transactionRoutes } from "./modules/transactions/transactions.routes.js";
import { authPlugin } from "./plugins/auth.js";
import { databasePlugin } from "./plugins/database.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { openApiPlugin } from "./plugins/openapi.js";
import { healthRoutes } from "./routes/health.js";

const VERSION = process.env.npm_package_version ?? "0.1.0";

/** Everything the app needs from the outside world, passed in rather than created inside. */
export interface AppDependencies {
  db: Database;
  /** Called on shutdown to release resources (e.g. close the connection pool). */
  closeDb?: () => Promise<void>;
}

/**
 * Builds a fully configured Fastify app WITHOUT starting to listen on a port.
 *
 * Separating "build the app" from "start the server" is a small decision with a
 * big payoff: tests can create an app and fire fake requests at it in memory
 * (see the *.test.ts files) — no ports, no network, very fast.
 */
export async function buildApp(env: Env, deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Pretty, colourful logs for humans in development; raw JSON lines in
      // production so log platforms (Datadog, Loki, CloudWatch…) can index them.
      ...(env.NODE_ENV === "development" && {
        transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
      }),
      // Never write secrets to logs.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    // Every request gets an ID so all log lines for one request can be correlated.
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: "x-request-id",
    // A JSON API never needs megabytes of input. A small limit blunts abuse.
    bodyLimit: 100 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  // Zod validates every request (params, query, headers, body) and every response.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Echo the request ID back so a user's bug report can be matched to our logs.
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  await app.register(errorHandlerPlugin);
  // Security headers. The API serves JSON, so the strictest CSP applies everywhere
  // except the interactive docs page, which needs to run its own scripts.
  await app.register(helmet, { global: true });
  // Only our own front-end origins may call this API from a browser.
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    exposedHeaders: ["location", "x-request-id", "idempotent-replayed"],
  });
  await app.register(sensible);
  await app.register(databasePlugin, { db: deps.db, close: deps.closeDb });
  await app.register(authPlugin);
  if (env.API_DOCS) await app.register(openApiPlugin, { version: VERSION });

  await app.register(healthRoutes, { version: VERSION });

  // Versioned API: /v1/… lets us ship breaking changes later as /v2 without
  // breaking existing clients.
  await app.register(
    async (v1) => {
      await v1.register(meRoutes);
      await v1.register(
        async (scoped) => {
          await scoped.register(householdScope);
          await scoped.register(householdRoutes);
          await scoped.register(accountRoutes);
          await scoped.register(categoryRoutes);
          await scoped.register(transactionRoutes);
          await scoped.register(reportRoutes);
        },
        { prefix: "/households/:householdId" },
      );
    },
    { prefix: "/v1" },
  );

  return app;
}
