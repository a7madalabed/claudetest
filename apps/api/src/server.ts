import { createDb } from "@ledgerly/db";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createRegistry, startMetricsServer } from "./lib/metrics.js";

// Load variables from apps/api/.env if it exists (Node's built-in loader — no
// extra library needed). Real environment variables always win over the file.
try {
  process.loadEnvFile();
} catch {
  // No .env file: fine, we rely on real environment variables (e.g. in production).
}

const env = loadEnv();
const database = createDb({
  connectionString: env.DATABASE_URL,
  maxConnections: env.DATABASE_POOL_MAX,
  applicationName: "ledgerly-api",
});
const metrics = env.METRICS_PORT > 0 ? createRegistry("api", env.APP_VERSION) : undefined;
const app = await buildApp(env, {
  db: database.db,
  closeDb: database.close,
  pool: database.pool,
  metrics,
});
const metricsServer = metrics
  ? await startMetricsServer(metrics, env.METRICS_PORT, app.log)
  : undefined;

/**
 * Graceful shutdown: when the platform asks us to stop (SIGTERM during a deploy,
 * or Ctrl+C locally):
 *   1. DRAIN: readiness starts answering 503, so the load balancer stops sending
 *      new requests here, while everything already in flight still completes;
 *   2. CLOSE: stop accepting connections, finish in-flight requests, end live
 *      streams (clients reconnect to another instance), close the pool; exit.
 * Without this, every deploy would cut some users off mid-request.
 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal, drainMs: env.SHUTDOWN_DRAIN_MS }, "Shutting down gracefully");
    app.draining = true;
    if (env.SHUTDOWN_DRAIN_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, env.SHUTDOWN_DRAIN_MS));
    }
    await app.close();
    await metricsServer?.stop();
    process.exit(0);
  });
}

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.fatal(error, "Failed to start server");
  process.exit(1);
}
