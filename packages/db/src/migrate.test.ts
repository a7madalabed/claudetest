import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { TEST_DATABASE_URL } from "./test/database.js";

/*
 * The two properties that make migrations safe to run during a deploy (Stage 14).
 * Each test gets a brand-new scratch database, so nothing here touches the
 * database the other tests share.
 */
const withDb = (name: string) => {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
};
const SCRATCH = "ledgerly_test_migrate";
const admin = new pg.Client({ connectionString: withDb("postgres") });

async function freshDatabase() {
  await admin.query(`drop database if exists "${SCRATCH}" with (force)`);
  await admin.query(`create database "${SCRATCH}"`);
  return withDb(SCRATCH);
}

beforeAll(() => admin.connect());
afterAll(async () => {
  await admin.query(`drop database if exists "${SCRATCH}" with (force)`);
  await admin.end();
});

describe("migrations", () => {
  it("two deploys migrating at the same moment both succeed (advisory lock)", async () => {
    const url = await freshDatabase();
    // Without the lock, both would try to create the same tables and one would crash.
    await Promise.all([runMigrations(url), runMigrations(url)]);

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const { rows } = await client.query(
      "select count(*)::int as n from drizzle.__drizzle_migrations",
    );
    await client.end();
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("gives up quickly instead of queueing behind a long-held table lock", async () => {
    const url = await freshDatabase();
    const app = new pg.Client({ connectionString: url });
    await app.connect();
    await app.query("create table accounts_probe (id int)");

    // A one-migration folder in Drizzle's format: it needs an exclusive lock.
    const folder = await mkdtemp(join(tmpdir(), "ledgerly-migrations-"));
    await mkdir(join(folder, "meta"));
    await writeFile(
      join(folder, "0000_add_column.sql"),
      "alter table accounts_probe add column note text;",
    );
    await writeFile(
      join(folder, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          { idx: 0, version: "7", when: Date.now(), tag: "0000_add_column", breakpoints: true },
        ],
      }),
    );

    try {
      // "Application traffic": a transaction holding a lock on the table.
      await app.query("begin");
      await app.query("lock table accounts_probe in access share mode");
      const started = Date.now();
      const error = await runMigrations(url, { migrationsFolder: folder, lockTimeoutMs: 300 }).then(
        () => null,
        (e: Error) => e,
      );
      // Drizzle wraps the database error ("Failed query: …"); the reason is its cause.
      expect(String((error?.cause as Error | undefined)?.message)).toMatch(/lock timeout/);
      expect(Date.now() - started).toBeLessThan(5_000);

      // Once the traffic is gone, the same migration goes through.
      await app.query("rollback");
      await runMigrations(url, { migrationsFolder: folder, lockTimeoutMs: 300 });
      const { rows } = await app.query(
        "select column_name from information_schema.columns where table_name = 'accounts_probe'",
      );
      expect(rows.map((r) => r.column_name)).toContain("note");
    } finally {
      await app.end();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
