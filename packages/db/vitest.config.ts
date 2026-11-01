import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Builds a fresh, fully-migrated test database once before all tests.
    globalSetup: ["./src/test/global-setup.ts"],
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
