import { defineConfig } from "vitest/config";
import { TEST_WORKERS } from "./src/test/database.js";

export default defineConfig({
  test: {
    globalSetup: ["./src/test/global-setup.ts"],
    // Stage 13: test FILES run in parallel, each worker on its own database copy
    // (see src/test/database.ts). Tests within a file still run one at a time.
    maxWorkers: TEST_WORKERS,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Process entry points (they only wire things together and listen on a port) and test helpers.
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/server.ts",
        "src/worker.ts",
        "src/migrate.ts",
      ],
      // A ratchet, set just under today's numbers: coverage may rise, never quietly fall.
      thresholds: { statements: 86, branches: 72, functions: 88, lines: 90 },
    },
  },
});
