import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import type { Env } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";

const VERSION = process.env.npm_package_version ?? "0.1.0";

/**
 * Builds a fully configured Fastify app WITHOUT starting to listen on a port.
 *
 * Separating "build the app" from "start the server" is a small decision with a
 * big payoff: tests can create an app and fire fake requests at it in memory
 * (see app.test.ts) — no ports, no network, very fast.
 */
export async function buildApp(env: Env): Promise<FastifyInstance> {
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
  });

  // Echo the request ID back so a user's bug report can be matched to our logs.
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  // Security headers (Content-Security-Policy, X-Content-Type-Options, …).
  await app.register(helmet);
  // Only our own front-end origins may call this API from a browser.
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  // Handy HTTP error helpers, e.g. `throw app.httpErrors.notFound()`.
  await app.register(sensible);

  await app.register(healthRoutes, { version: VERSION });

  return app;
}
