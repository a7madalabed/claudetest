import { createDb } from "@ledgerly/db";
import { pino } from "pino";
import { loadEnv } from "./config/env.js";
import { jobDefinitions, schedules } from "./jobs/definitions.js";
import { Worker } from "./jobs/worker.js";
import { createMailer } from "./lib/mailer.js";
import { createRegistry, gaugeOnScrape, jobMetrics, startMetricsServer } from "./lib/metrics.js";

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
  base: { service: "worker", version: env.APP_VERSION },
  ...(env.NODE_ENV === "development" && {
    transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
  }),
});

const database = createDb({
  connectionString: env.DATABASE_URL,
  // Jobs + the LISTEN connection + headroom.
  maxConnections: env.WORKER_CONCURRENCY + 2,
  applicationName: "ledgerly-worker",
  // Background work may legitimately run longer than a web request.
  statementTimeoutMs: 60_000,
});

/*
 * Metrics: what ran and how it went, plus the QUEUE itself, read from the
 * database at scrape time. "How many jobs are waiting, and how long has the
 * oldest waited?" is the single best health signal for a background system:
 * if it grows, work is arriving faster than we finish it.
 */
const metrics = env.METRICS_PORT > 0 ? createRegistry("worker", env.APP_VERSION) : undefined;
let onJobFinished: ConstructorParameters<typeof Worker>[0]["onJobFinished"];
if (metrics) {
  const { jobDuration, jobsTotal } = jobMetrics(metrics);
  onJobFinished = (job, outcome, seconds) => {
    jobDuration.observe({ job_name: job, outcome }, seconds);
    jobsTotal.inc({ job_name: job, outcome });
  };
  const queue = async () => {
    const { rows } = await database.pool.query<{ ready: number; oldest: number | null }>(
      `select count(*)::int as ready,
              extract(epoch from now() - min(run_at))::float8 as oldest
         from jobs where status = 'queued' and run_at <= now()`,
    );
    return rows[0]!;
  };
  gaugeOnScrape(
    metrics,
    "ledgerly_jobs_ready",
    "Jobs due to run but not started",
    async () => (await queue()).ready,
  );
  gaugeOnScrape(
    metrics,
    "ledgerly_jobs_oldest_ready_age_seconds",
    "How long the oldest due job has been waiting (0 = none waiting)",
    async () => (await queue()).oldest ?? 0,
  );
}
const metricsServer = metrics
  ? await startMetricsServer(metrics, env.METRICS_PORT, log)
  : undefined;

const worker = new Worker({
  db: database.db,
  pool: database.pool,
  definitions: jobDefinitions({ appUrl: env.APP_URL, encryptionKey: env.ENCRYPTION_KEY }),
  schedules,
  mailer: createMailer(env, log),
  log,
  concurrency: env.WORKER_CONCURRENCY,
  onJobFinished,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    log.info({ signal }, "Shutting down gracefully");
    await worker.stop();
    await metricsServer?.stop();
    await database.close();
    process.exit(0);
  });
}

await worker.start();
