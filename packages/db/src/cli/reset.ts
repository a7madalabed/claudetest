import pg from "pg";
import { assertSafeToWipe, requireDatabaseUrl } from "./env.js";

const url = requireDatabaseUrl();
assertSafeToWipe(url);

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // Drop EVERYTHING (tables, types, migration history) and start again.
  await client.query(
    "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;",
  );
  console.log("🧹 Database wiped");
} finally {
  await client.end();
}
