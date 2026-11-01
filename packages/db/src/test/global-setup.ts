import pg from "pg";
import { runMigrations } from "../migrate.js";
import { TEST_DATABASE_URL } from "./database.js";

/** Runs once before the whole test suite: wipe the test DB and apply all migrations. */
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query(
    "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;",
  );
  await client.end();
  await runMigrations(TEST_DATABASE_URL);
}
