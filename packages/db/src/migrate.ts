import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** Absolute path to the SQL migrations (works from both src/ and dist/). */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Arbitrary but fixed number identifying "the migration lock" for this app. */
const MIGRATION_LOCK_ID = 727_001;

export interface MigrateOptions {
  /** Defaults to this package's migrations; tests point it at their own. */
  migrationsFolder?: string;
  /**
   * Give up if a migration waits longer than this for a table lock (Stage 14).
   *
   * Why it matters: `ALTER TABLE` needs an exclusive lock. If a long query is
   * running on that table, the ALTER waits — and every NEW query on the table
   * queues up BEHIND the waiting ALTER. A migration stuck for a minute takes
   * the whole app down for a minute. With a lock timeout it fails fast, the
   * deploy stops (the old version keeps serving), and you retry later.
   */
  lockTimeoutMs?: number;
}

/**
 * Applies every pending migration, in order, exactly once.
 *
 * Drizzle records applied migrations in the `drizzle.__drizzle_migrations` table.
 * We also take a Postgres *advisory lock* first: if two deploys (or two server
 * instances) try to migrate at the same moment, the second one waits for the
 * first to finish instead of both applying the same migration and crashing.
 */
export async function runMigrations(
  connectionString: string,
  { migrationsFolder: folder = migrationsFolder, lockTimeoutMs = 10_000 }: MigrateOptions = {},
): Promise<void> {
  // A single dedicated connection: advisory locks belong to one session.
  const client = new pg.Client({ connectionString, application_name: "ledgerly-migrate" });
  await client.connect();
  try {
    // Wait as long as needed for ANOTHER MIGRATOR (that's expected and safe)…
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    // …but not for application traffic holding a table lock.
    await client.query(`set lock_timeout = ${Math.round(lockTimeoutMs)}`);
    await migrate(drizzle({ client }), { migrationsFolder: folder });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    await client.end();
  }
}
