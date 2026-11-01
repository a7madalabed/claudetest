import type { HealthResponse } from "@ledgerly/shared";
import type { FastifyPluginAsync } from "fastify";

/**
 * Liveness endpoint. Load balancers, Docker and Kubernetes call this to decide
 * whether the process is alive. In later stages we'll add a separate
 * "readiness" check that also verifies the database and Redis connections.
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
};
