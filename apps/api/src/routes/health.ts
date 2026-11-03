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
declare module "fastify" {
  interface FastifyInstance {
    /** Set on SIGTERM: readiness reports 503 so load balancers stop sending traffic. */
    draining: boolean;
  }
}

export const healthRoutes: FastifyPluginAsync<{ version: string }> = async (app, opts) => {
  app.get(
    "/health",
    { schema: { tags: ["System"], summary: "Liveness: is the process up?" } },
    async (): Promise<HealthResponse> => {
      return {
        status: "ok",
        service: "ledgerly-api",
        version: opts.version,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      };
    },
  );

  app.get(
    "/health/ready",
    {
      schema: {
        tags: ["System"],
        summary: "Readiness: can it serve traffic (database reachable)?",
      },
    },
    async (request, reply) => {
      // Shutting down: alive (finishing in-flight requests) but not taking new ones.
      if (app.draining) {
        return reply.code(503).send({ status: "draining", checks: {} });
      }
      const started = performance.now();
      try {
        await Promise.race([
          app.db.execute(sql`select 1`),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2_000)),
        ]);
        return {
          status: "ready",
          checks: {
            database: { status: "up", latencyMs: Math.round(performance.now() - started) },
          },
        };
      } catch (error) {
        request.log.warn({ err: error }, "Readiness check failed: database unreachable");
        return reply
          .code(503)
          .send({ status: "unavailable", checks: { database: { status: "down" } } });
      }
    },
  );
};
