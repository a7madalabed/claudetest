import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@ledgerly/db";
import pg from "pg";
import { E2E_API_PORT, E2E_DATABASE_URL, E2E_WEB_URL } from "../src/env.js";

/*
 * Starts the back end for the end-to-end suite, exactly as production runs it:
 * the BUILT API (apps/api/dist) and the background worker, on a brand-new,
 * fully migrated database. Playwright runs this as a `webServer` and waits for
 * /health/ready before any test starts.
 *
 * A fresh database per run means no test can depend on leftovers from the
 * last run — and every test makes its own users anyway (see src/fixtures.ts).
 */

const url = new URL(E2E_DATABASE_URL);
const name = url.pathname.slice(1);
if (!/test/i.test(name) || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  // This script DROPS the database. Refuse anything that could be real data.
  throw new Error(
    `Refusing to reset ${url.host}/${name}: use a local database whose name contains "test"`,
  );
}

const admin = new pg.Client({
  connectionString: Object.assign(new URL(url), { pathname: "/postgres" }).toString(),
});
await admin.connect();
await admin.query(`drop database if exists "${name}" with (force)`);
await admin.query(`create database "${name}"`);
await admin.end();
await runMigrations(E2E_DATABASE_URL);

const env = {
  ...process.env,
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: String(E2E_API_PORT),
  DATABASE_URL: E2E_DATABASE_URL,
  CORS_ORIGINS: E2E_WEB_URL,
  APP_URL: E2E_WEB_URL,
  // A throwaway key: nothing in this database is secret.
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  COOKIE_SECURE: "true",
  TRUST_PROXY: "1",
  // Every test signs up from the same IP within seconds; the limits would answer
  // 429. Rate limiting has its own API integration tests (auth/security.test.ts).
  RATE_LIMIT_ENABLED: "false",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
  WORKER_CONCURRENCY: "4",
};

const dist = (file: string) =>
  fileURLToPath(new URL(`../../apps/api/dist/${file}`, import.meta.url));
const children: ChildProcess[] = [
  spawn(process.execPath, [dist("server.js")], { env, stdio: "inherit" }),
  spawn(process.execPath, [dist("worker.js")], { env, stdio: "inherit" }),
];

// One goes down → take the other down too, so Playwright notices instead of hanging.
for (const child of children) {
  child.on("exit", (code) => {
    for (const other of children) if (other !== child) other.kill("SIGTERM");
    process.exitCode = code ?? 1;
  });
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
