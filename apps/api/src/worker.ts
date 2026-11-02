import { createDb } from "@ledgerly/db";
import { pino } from "pino";
import { loadEnv } from "./config/env.js";
import { jobDefinitions, schedules } from "./jobs/definitions.js";
import { Worker } from "./jobs/worker.js";
import { LogMailer } from "./lib/mailer.js";

/*
 * The background worker: a SEPARATE PROCESS from the API, built from the same
 * code. The API answers requests in milliseconds; slow work (imports, emails,
 * scheduled tasks) happens here, so it can never make a request slow — and the
 * two can be scaled independently (e.g. 3 API instances, 1 worker).
 */
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on real environment variables.
}

const env = loadEnv();
const log = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "development" && {
    transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
  }),
}).child({ service: "worker" });

const database = createDb({
  connectionString: env.DATABASE_URL,
  // Jobs + the LISTEN connection + headroom.
  maxConnections: env.WORKER_CONCURRENCY + 2,
  applicationName: "ledgerly-worker",
  // Background work may legitimately run longer than a web request.
  statementTimeoutMs: 60_000,
});

const worker = new Worker({
  db: database.db,
  pool: database.pool,
  definitions: jobDefinitions({ appUrl: env.APP_URL }),
  schedules,
  mailer: new LogMailer(log),
  log,
  concurrency: env.WORKER_CONCURRENCY,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    log.info({ signal }, "Shutting down gracefully");
    await worker.stop();
    await database.close();
    process.exit(0);
  });
}

await worker.start();
