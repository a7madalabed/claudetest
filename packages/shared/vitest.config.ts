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
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // src/api holds Zod schemas: declarations, not logic. The API's tests
      // exercise them on every request, and the OpenAPI snapshot pins their shape.
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/**/index.ts",
        "src/api/**",
        "src/health.ts",
      ],
      // A ratchet, set just under today's numbers: coverage may rise, never quietly fall.
      thresholds: { statements: 95, branches: 85, functions: 95, lines: 97 },
    },
  },
});
