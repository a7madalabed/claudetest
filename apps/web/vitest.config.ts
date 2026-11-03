import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/*
 * Run every test in a time zone west of UTC. CI machines run in UTC, where the
 * classic "new Date('2026-03-14') is the 13th in California" bug can't show.
 * Set here (before the test workers start) so modules that build formatters at
 * import time see it too.
 */
// A default: `TZ=Pacific/Kiritimati pnpm test` still tries another zone.
process.env.TZ ??= "America/Los_Angeles";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
      // Components are covered by the Playwright suite (e2e/); this floor guards the unit-tested logic.
      // A ratchet, set just under today's numbers: coverage may rise, never quietly fall.
      thresholds: { statements: 12, branches: 11, functions: 7, lines: 12 },
    },
  },
});
