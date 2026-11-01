import { createDb } from "@ledgerly/db";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

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
const app = await buildApp(env, { db: database.db, closeDb: database.close });

/**
 * Graceful shutdown: when the platform asks us to stop (SIGTERM during a deploy,
 * or Ctrl+C locally) we stop accepting new connections, let in-flight requests
 * finish, then exit. Without this, deploys would cut users off mid-request.
 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "Shutting down gracefully");
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.fatal(error, "Failed to start server");
  process.exit(1);
}
