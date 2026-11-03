import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Builds a fresh, fully-migrated test database once before all tests.
    globalSetup: ["./src/test/global-setup.ts"],
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Command-line entry points and test helpers aren't the product.
      exclude: ["src/**/*.test.ts", "src/test/**", "src/cli/**"],
      // A ratchet, set just under today's numbers: coverage may rise, never quietly fall.
      thresholds: { statements: 78, branches: 88, functions: 60, lines: 78 },
    },
  },
});
