import { sql } from "drizzle-orm";
import { createDb } from "../client.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file — use real environment variables (e.g. in CI).
}

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://ledgerly:ledgerly@localhost:5432/ledgerly_test";

if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
  // Tests TRUNCATE every table. Guard against pointing them at a real database.
  throw new Error(`TEST_DATABASE_URL must point at a database whose name contains "test"`);
}

export function createTestDb() {
  return createDb({ connectionString: TEST_DATABASE_URL, maxConnections: 4 });
}

export async function truncateAll(db: ReturnType<typeof createTestDb>["db"]) {
  await db.execute(
    sql`truncate table transactions, categories, accounts, household_members, households, users cascade`,
  );
}
