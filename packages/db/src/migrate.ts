import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** Absolute path to the SQL migrations (works from both src/ and dist/). */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Arbitrary but fixed number identifying "the migration lock" for this app. */
const MIGRATION_LOCK_ID = 727_001;

/**
 * Applies every pending migration, in order, exactly once.
 *
 * Drizzle records applied migrations in the `drizzle.__drizzle_migrations` table.
 * We also take a Postgres *advisory lock* first: if two deploys (or two server
 * instances) try to migrate at the same moment, the second one waits for the
 * first to finish instead of both applying the same migration and crashing.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  // A single dedicated connection: advisory locks belong to one session.
  const client = new pg.Client({ connectionString, application_name: "ledgerly-migrate" });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    await client.end();
  }
}
