import { sql } from "drizzle-orm";
import { createDb } from "../client.js";
import { seedDemoData } from "../seed.js";
import { assertSafeToWipe, requireDatabaseUrl } from "./env.js";

const url = requireDatabaseUrl();
assertSafeToWipe(url);

const { db, close } = createDb({
  connectionString: url,
  maxConnections: 1,
  statementTimeoutMs: 60_000,
});
try {
  // Start from a clean slate so running the seed twice doesn't duplicate data.
  await db.execute(
    sql`truncate table recovery_codes, sessions, idempotency_keys, transactions, categories, accounts, household_members, households, users restart identity cascade`,
  );
  const result = await seedDemoData(db);
  console.log(`✅ Seeded demo household with ${result.transactionCount} transactions`);
  console.log(`   Demo user: demo@ledgerly.app (household ${result.householdId})`);
} finally {
  await close();
}
