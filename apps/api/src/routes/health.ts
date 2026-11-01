import type { HealthResponse } from "@ledgerly/shared";
import { sql } from "@ledgerly/db";
import type { FastifyPluginAsync } from "fastify";

/**
 * Two kinds of health check — a distinction every orchestrator (Kubernetes,
 * ECS, Fly.io, Render…) relies on:
 *
 *  GET /health        LIVENESS  — "is the process alive?" Never touches dependencies.
 *                     If this fails, the platform RESTARTS the instance.
 *
 *  GET /health/ready  READINESS — "can this instance serve traffic right now?"
 *                     Checks the database. If it fails, the load balancer stops
 *                     SENDING traffic here (but doesn't restart it). If liveness
 *                     checked the DB, a database blip would restart every instance
 *                     at once — turning a small outage into a big one.
 */
export const healthRoutes: FastifyPluginAsync<{ version: string }> = async (app, opts) => {
  app.get("/health", async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      service: "ledgerly-api",
      version: opts.version,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/health/ready", async (request, reply) => {
    const started = performance.now();
    try {
      await Promise.race([
        app.db.execute(sql`select 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2_000)),
      ]);
      return {
        status: "ready",
        checks: { database: { status: "up", latencyMs: Math.round(performance.now() - started) } },
      };
    } catch (error) {
      request.log.warn({ err: error }, "Readiness check failed: database unreachable");
      return reply
        .code(503)
        .send({ status: "unavailable", checks: { database: { status: "down" } } });
    }
  });
};
