import { createDb } from "@ledgerly/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { API_TEST_DATABASE_URL } from "../test/database.js";
import { OUTSIDER, OWNER, request, testEnv, useTestApp } from "../test/helpers.js";
import { LruCache } from "./response-cache.js";

describe("response cache", () => {
  const ctx = useTestApp();
  const url = () =>
    `/v1/households/${ctx.fixtures.householdId}/reports/cashflow?from=2026-01-01&to=2026-07-01`;
  const get = (headers: Record<string, string> = {}, user = OWNER) =>
    request(ctx.app, user, { method: "GET", url: url(), headers });
  const addExpense = async (app = ctx.app) => {
    const accounts = (
      await request(app, OWNER, {
        method: "GET",
        url: `/v1/households/${ctx.fixtures.householdId}/accounts`,
      })
    ).json().data;
    const created = await request(app, OWNER, {
      method: "POST",
      url: `/v1/households/${ctx.fixtures.householdId}/transactions`,
      payload: {
        accountId: accounts[0].id,
        amountMinor: -12_345,
        occurredOn: "2026-06-10",
        description: "Cache test",
      },
    });
    expect(created.statusCode).toBe(201);
  };
  const juneSpending = (body: { months: Array<{ month: string; spendingMinor: number }> }) =>
    body.months.find((m) => m.month === "2026-06")!.spendingMinor;

  it("serves the second identical read from the cache", async () => {
    const first = await get();
    const second = await get();
    expect(first.headers["x-cache"]).toBe("miss");
    expect(second.headers["x-cache"]).toBe("hit");
    expect(second.body).toBe(first.body);
    expect(second.headers["content-type"]).toMatch(/application\/json/);
  });

  it("answers 304 Not Modified when the browser's copy is current", async () => {
    const first = await get();
    const revalidated = await get({ "if-none-match": first.headers.etag as string });
    expect(revalidated.statusCode).toBe(304);
    expect(revalidated.body).toBe("");
    expect(first.headers["cache-control"]).toBe("private, no-cache");
  });

  it("is invalidated by any write — the next read is fresh", async () => {
    const before = await get();
    await get(); // cached
    await addExpense();
    const after = await get({ "if-none-match": before.headers.etag as string });
    expect(after.statusCode).toBe(200); // the old ETag no longer matches
    expect(after.headers["x-cache"]).toBe("miss");
    expect(juneSpending(after.json()) - juneSpending(before.json())).toBe(12_345);
  });

  describe("with two API instances", () => {
    const other = createDb({ connectionString: API_TEST_DATABASE_URL, maxConnections: 2 });
    let second: Awaited<ReturnType<typeof buildApp>>;
    beforeAll(async () => {
      second = await buildApp(testEnv(), { db: other.db, closeDb: other.close });
    });
    afterAll(() => second.close());

    it("a write through instance B invalidates instance A's cache immediately", async () => {
      const before = await get();
      expect((await get()).headers["x-cache"]).toBe("hit");
      await addExpense(second);
      const after = await get();
      expect(after.headers["x-cache"]).toBe("miss");
      expect(juneSpending(after.json()) - juneSpending(before.json())).toBe(12_345);
    });
  });

  it("never serves one household's cached data to someone else", async () => {
    await get();
    expect((await get({}, OUTSIDER)).statusCode).toBe(404); // the membership check runs first
  });

  it("leaves routes without `cache: true` alone", async () => {
    const members = await request(ctx.app, OWNER, {
      method: "GET",
      url: `/v1/households/${ctx.fixtures.householdId}/members`,
    });
    expect(members.headers["x-cache"]).toBeUndefined();
    expect(members.headers.etag).toBeUndefined();
  });
});

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const cache = new LruCache<number>(2, 60_000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // a is now the most recent
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("expires entries after their time-to-live", () => {
    const cache = new LruCache<number>(10, -1);
    cache.set("a", 1);
    expect(cache.get("a")).toBeUndefined();
  });
});
