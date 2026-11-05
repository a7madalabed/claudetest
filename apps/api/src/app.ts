import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import type { Database } from "@ledgerly/db";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import type { Registry } from "prom-client";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { accountRoutes } from "./modules/accounts/accounts.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { privacyRoutes } from "./modules/privacy/privacy.routes.js";
import { budgetRoutes } from "./modules/budgets/budgets.routes.js";
import { categoryRoutes } from "./modules/categories/categories.routes.js";
import { goalRoutes } from "./modules/goals/goals.routes.js";
import { importRoutes } from "./modules/imports/imports.routes.js";
import {
  householdRoutes,
  invitationRoutes,
  meRoutes,
} from "./modules/households/households.routes.js";
import { householdScope } from "./modules/households/scope.js";
import { notificationRoutes } from "./modules/notifications/notifications.routes.js";
import { recurringRoutes } from "./modules/recurring/recurring.routes.js";
import { reportRoutes } from "./modules/reports/reports.routes.js";
import { transactionRoutes } from "./modules/transactions/transactions.routes.js";
import { authPlugin } from "./plugins/auth.js";
import { csrfPlugin } from "./plugins/csrf.js";
import { databasePlugin } from "./plugins/database.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { metricsPlugin } from "./plugins/metrics.js";
import { openApiPlugin } from "./plugins/openapi.js";
import { responseCachePlugin } from "./plugins/response-cache.js";
import { realtimePlugin } from "./realtime/events.plugin.js";
import { healthRoutes } from "./routes/health.js";

/** Request IDs we accept from upstream (e.g. a proxy's UUID); anything else is replaced. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Everything the app needs from the outside world, passed in rather than created inside. */
export interface AppDependencies {
  db: Database;
  /** Called on shutdown to release resources (e.g. close the connection pool). */
  closeDb?: () => Promise<void>;
  /** The raw pool, for the realtime LISTEN connection. Without it, /v1/events is off. */
  pool?: pg.Pool;
  /** Where to record Prometheus metrics. Without it, nothing is measured. */
  metrics?: Registry;
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
      // On every line: which service, which build. "Did the errors start with
      // the new release?" becomes a filter, not an investigation.
      base: { service: "api", version: env.APP_VERSION },
    },
    /*
     * Every request gets an ID so all log lines for one request can be correlated.
     * An upstream proxy may pass its own (X-Request-Id) to correlate across hops,
     * but only if it LOOKS like an ID: otherwise any client could write
     * arbitrary text into our logs.
     */
    requestIdHeader: false,
    genReqId: (request) => {
      const incoming = request.headers["x-request-id"];
      return typeof incoming === "string" && VALID_REQUEST_ID.test(incoming)
        ? incoming
        : crypto.randomUUID();
    },
    // A JSON API never needs megabytes of input. A small limit blunts abuse.
    bodyLimit: 100 * 1024,
    // Behind a load balancer, the client's real IP arrives in X-Forwarded-For.
    // Only trust that header when we KNOW a proxy sets it — otherwise anyone could
    // forge it to dodge IP-based rate limits.
    trustProxy: env.TRUST_PROXY,
  }).withTypeProvider<ZodTypeProvider>();

  // Only JSON bodies. Removing Fastify's default text/plain parser closes a CSRF
  // trick where an HTML form posts JSON-looking text with enctype="text/plain".
  app.removeContentTypeParser("text/plain");

  // Zod validates every request (params, query, headers, body) and every response.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook("onRequest", async (request, reply) => {
    // Echo the request ID back so a user's bug report can be matched to our logs.
    reply.header("x-request-id", request.id);
    // CONNECTION DRAINING (Stage 14): while shutting down, ask every client to
    // close its kept-alive connection after this response. It reconnects, and
    // lands on an instance that isn't going away.
    if (app.draining) reply.header("connection", "close");
  });

  if (deps.metrics) await app.register(metricsPlugin, { registry: deps.metrics, pool: deps.pool });
  await app.register(errorHandlerPlugin);
  // Security headers. The API serves JSON, so the strictest CSP applies everywhere
  // except the interactive docs page, which needs to run its own scripts.
  await app.register(helmet, { global: true });
  // Only our own front-end origins may call this API from a browser.
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    exposedHeaders: ["location", "x-request-id", "idempotent-replayed", "retry-after"],
  });
  await app.register(sensible);
  await app.register(csrfPlugin, { allowedOrigins: env.CORS_ORIGINS });
  if (env.RATE_LIMIT_ENABLED) {
    // A generous global limit per client (stops scrapers and runaway scripts).
    // Its counters live in this process's memory: approximate by design (they
    // reset on deploy, and each instance counts separately), which is fine for
    // a coarse limit. Anything protecting a SECRET (passwords, 2FA codes, reset
    // emails) uses the database-backed counters in modules/auth/throttle.ts.
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: "1 minute",
      errorResponseBuilder: (_request, context) =>
        new AppError(
          429,
          "rate_limited",
          "Too many requests",
          `Slow down — try again in ${context.after}.`,
        ),
    });
  }
  await app.register(databasePlugin, { db: deps.db, close: deps.closeDb });
  await app.register(responseCachePlugin, {
    maxEntries: env.RESPONSE_CACHE_MAX,
    // A safety net only: versions already make stale entries unreachable.
    ttlMs: 10 * 60_000,
  });
  await app.register(authPlugin, {
    cookieSecure: env.COOKIE_SECURE,
    idleDays: env.SESSION_IDLE_DAYS,
  });
  if (env.API_DOCS) {
    await app.register(openApiPlugin, {
      version: env.APP_VERSION,
      cookieName: app.sessionCookieName,
    });
  }

  // On the ROOT instance, so server.ts (which only holds the root) can flip it
  // and the encapsulated health routes see the change.
  app.decorate("draining", false);
  await app.register(healthRoutes, { version: env.APP_VERSION });

  // Live updates over Server-Sent Events (needs a raw pool for LISTEN).
  if (deps.pool) {
    await app.register(realtimePlugin, { pool: deps.pool, heartbeatMs: env.REALTIME_HEARTBEAT_MS });
  }

  // Versioned API: /v1/… lets us ship breaking changes later as /v2 without
  // breaking existing clients.
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, {
        prefix: "/auth",
        encryptionKey: env.ENCRYPTION_KEY,
        ttlDays: env.SESSION_TTL_DAYS,
        ipLimits: env.RATE_LIMIT_ENABLED,
      });
      await v1.register(meRoutes);
      await v1.register(privacyRoutes, { encryptionKey: env.ENCRYPTION_KEY });
      await v1.register(invitationRoutes);
      await v1.register(notificationRoutes);
      await v1.register(
        async (scoped) => {
          await scoped.register(householdScope);
          await scoped.register(householdRoutes, {
            encryptionKey: env.ENCRYPTION_KEY,
            appUrl: env.APP_URL,
          });
          await scoped.register(accountRoutes);
          await scoped.register(categoryRoutes);
          await scoped.register(transactionRoutes);
          await scoped.register(reportRoutes);
          await scoped.register(budgetRoutes);
          await scoped.register(goalRoutes);
          await scoped.register(importRoutes);
          await scoped.register(recurringRoutes);
        },
        { prefix: "/households/:householdId" },
      );
    },
    { prefix: "/v1" },
  );

  return app;
}
