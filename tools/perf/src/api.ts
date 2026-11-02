import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { API_URL, PERF_DATABASE_URL } from "./env.js";

/*
 * Runs the PRODUCTION build of the API (apps/api/dist) against the perf
 * database. Measure what you ship: development mode (tsx, pretty logs) is
 * much slower and would make every number meaningless.
 *
 *   pnpm --filter @ledgerly/api build && pnpm --filter @ledgerly/perf run api
 *
 * Extra environment variables pass through, e.g. DATABASE_POOL_MAX=20.
 */
const server = fileURLToPath(new URL("../../../apps/api/dist/server.js", import.meta.url));
const port = new URL(API_URL).port;

const child = spawn(process.execPath, [server], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
    HOST: "127.0.0.1",
    DATABASE_URL: PERF_DATABASE_URL,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"), // a throwaway key: nothing here is secret
    COOKIE_SECURE: "true",
    LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
    // The load test sends thousands of requests from one IP: rate limits would answer 429.
    RATE_LIMIT_ENABLED: "false",
    API_DOCS: "false",
    TRUST_PROXY: "false",
  },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
