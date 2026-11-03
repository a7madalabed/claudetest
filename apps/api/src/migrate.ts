import { runMigrations } from "@ledgerly/db";
import { pino } from "pino";

/*
 * `node dist/migrate.js` — apply pending database migrations, then exit.
 *
 * Production runs this as a ONE-OFF step before rolling out a new version,
 * not when each server starts: with three API instances starting at once,
 * "migrate on boot" means three migrators racing, and a slow migration would
 * delay every instance's start (and its health checks) along with it.
 *
 * Exit code 0 = schema is current; anything else = stop the deploy. The old
 * version keeps running against the old schema, which every migration must
 * stay compatible with (expand/contract — see docs/stage-14).
 */
const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "migrate", version: process.env.APP_VERSION ?? "dev" },
});

const url = process.env.DATABASE_URL;
if (!url) {
  log.fatal("DATABASE_URL is not set");
  process.exit(1);
}

const started = performance.now();
try {
  await runMigrations(url, {
    lockTimeoutMs: Number(process.env.MIGRATION_LOCK_TIMEOUT_MS ?? 10_000),
  });
  log.info({ ms: Math.round(performance.now() - started) }, "Database schema is up to date");
} catch (error) {
  // The interesting reason (e.g. "canceling statement due to lock timeout") is
  // often the database error wrapped inside the query error.
  const cause = (error as Error).cause as Error | undefined;
  log.fatal({ err: error, reason: cause?.message }, "Migration failed; stop the deploy");
  process.exitCode = 1;
}
