import { availableParallelism } from "node:os";

try {
  process.loadEnvFile();
} catch {
  // CI provides real environment variables.
}

/**
 * The API's integration tests get their OWN databases (separate from the db
 * package's tests, which run in parallel with ours under Turborepo).
 *
 * Stage 13: one database PER TEST WORKER. The global setup migrates a template
 * once, then clones it (CREATE DATABASE … TEMPLATE — a file copy, very fast)
 * into ledgerly_api_test_1, _2, … Each worker process only ever touches its
 * own copy, so test files can run in parallel without seeing each other's data.
 */
const TEMPLATE_DATABASE_URL =
  process.env.API_TEST_DATABASE_URL ??
  "postgres://ledgerly:ledgerly@localhost:5432/ledgerly_api_test";

if (!/test/i.test(new URL(TEMPLATE_DATABASE_URL).pathname)) {
  throw new Error('API_TEST_DATABASE_URL must point at a database whose name contains "test"');
}

/** How many test files run at once (and how many database copies exist). */
export const TEST_WORKERS = Number(
  process.env.TEST_WORKERS ?? Math.min(4, Math.max(1, availableParallelism())),
);

export const withDatabase = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

export const templateDatabase = {
  url: TEMPLATE_DATABASE_URL,
  name: new URL(TEMPLATE_DATABASE_URL).pathname.slice(1),
};

/** Vitest numbers its workers 1…N (VITEST_POOL_ID); outside a worker, use copy 1. */
export const API_TEST_DATABASE_URL = withDatabase(
  TEMPLATE_DATABASE_URL,
  `${templateDatabase.name}_${process.env.VITEST_POOL_ID ?? "1"}`,
);
