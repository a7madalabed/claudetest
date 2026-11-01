import { runMigrations } from "@ledgerly/db";
import pg from "pg";
import { API_TEST_DATABASE_URL } from "./database.js";

/** Once per test run: wipe the API test database and apply every migration. */
export default async function setup() {
  const client = new pg.Client({ connectionString: API_TEST_DATABASE_URL });
  await client.connect();
  await client.query(
    "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;",
  );
  await client.end();
  await runMigrations(API_TEST_DATABASE_URL);
}
