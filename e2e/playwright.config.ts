import { defineConfig, devices } from "@playwright/test";
import { E2E_API_URL, E2E_DIST_DIR, E2E_WEB_PORT, E2E_WEB_URL } from "./src/env.js";

const CI = Boolean(process.env.CI);

/*
 * End-to-end tests drive a real browser against the real stack: the built web
 * app, the built API, the worker and Postgres. Nothing is mocked.
 *
 *   pnpm e2e            build what's needed, start everything, run the suite
 *   pnpm e2e:ui         the same, in Playwright's interactive UI mode
 */
export default defineConfig({
  testDir: "./tests",
  // Every test creates its own users and data, so tests can run in parallel.
  fullyParallel: true,
  // A stray `test.only` must not silently skip the rest of the suite in CI.
  forbidOnly: CI,
  /*
   * Retries ONLY in CI, and a test that passes on retry is reported as "flaky",
   * not hidden. Locally a failure should fail, loudly, the first time.
   */
  retries: CI ? 2 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: E2E_WEB_URL,
    // When a test fails on its first retry, keep a full trace (DOM snapshots,
    // network, console) to replay it step by step: `pnpm --filter @ledgerly/e2e report`.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Same zone as the server so "this month" means the same thing to both.
    timezoneId: "UTC",
    locale: "en-US",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      // API + worker on a fresh database (scripts/servers.ts).
      command: "pnpm run servers",
      url: `${E2E_API_URL}/health/ready`,
      reuseExistingServer: !CI,
      timeout: 60_000,
      stdout: "pipe",
    },
    {
      // The production web build made by `pnpm --filter @ledgerly/e2e build:web`.
      command: `node node_modules/next/dist/bin/next start --port ${E2E_WEB_PORT}`,
      cwd: "../apps/web",
      env: {
        NEXT_DIST_DIR: E2E_DIST_DIR,
        // Read at RUNTIME by Server Components that call the API directly (lib/api/server.ts);
        // the /api rewrite read it at BUILD time. Both must point at the e2e API.
        API_URL: E2E_API_URL,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      url: `${E2E_WEB_URL}/login`,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
