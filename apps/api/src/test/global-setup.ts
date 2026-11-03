import { runMigrations } from "@ledgerly/db";
import pg from "pg";
import { TEST_WORKERS, templateDatabase, withDatabase } from "./database.js";

/**
 * Once per test run:
 *   1. wipe the TEMPLATE database and apply every migration to it (once);
 *   2. clone it into one database per worker.
 * Cloning a migrated database takes milliseconds; migrating N databases
 * separately would repeat the slow part N times.
 */
export default async function setup() {
  const template = new pg.Client({ connectionString: templateDatabase.url });
  await template.connect();
  await template.query(
    "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;",
  );
  await template.end();
  await runMigrations(templateDatabase.url);

  // CREATE/DROP DATABASE must run from another database (the default "postgres").
  const admin = new pg.Client({ connectionString: withDatabase(templateDatabase.url, "postgres") });
  await admin.connect();
  try {
    for (let worker = 1; worker <= TEST_WORKERS; worker++) {
      const name = `${templateDatabase.name}_${worker}`;
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.query(`create database "${name}" template "${templateDatabase.name}"`);
    }
  } finally {
    await admin.end();
  }
}
