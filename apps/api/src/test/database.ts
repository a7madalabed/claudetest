try {
  process.loadEnvFile();
} catch {
  // CI provides real environment variables.
}

/**
 * The API's integration tests get their OWN database (separate from the db
 * package's tests), because Turborepo runs packages' test suites in parallel
 * and both wipe their database.
 */
export const API_TEST_DATABASE_URL =
  process.env.API_TEST_DATABASE_URL ??
  "postgres://ledgerly:ledgerly@localhost:5432/ledgerly_api_test";

if (!/test/i.test(new URL(API_TEST_DATABASE_URL).pathname)) {
  throw new Error('API_TEST_DATABASE_URL must point at a database whose name contains "test"');
}
