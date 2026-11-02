import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  accounts,
  householdMembers,
  households,
  notifications,
  transactions,
  users,
} from "./schema.js";
import { TEST_DATABASE_URL, createTestDb, truncateAll } from "./test/database.js";

const { db, close } = createTestDb();
const listener = new pg.Client({ connectionString: TEST_DATABASE_URL });
let received: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  await listener.connect();
  listener.on("notification", (m) => received.push(JSON.parse(m.payload!)));
  await listener.query("LISTEN ledgerly_events");
});
afterAll(async () => {
  await listener.end();
  await close();
});
beforeEach(async () => {
  await truncateAll(db);
  await settle();
  received = [];
});

/** Notifications arrive asynchronously, just after COMMIT. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

async function fixture() {
  const [user] = await db
    .insert(users)
    .values({ email: "a@example.com", displayName: "A" })
    .returning();
  const [household] = await db.insert(households).values({ name: "Live" }).returning();
  const [account] = await db
    .insert(accounts)
    .values({ householdId: household!.id, name: "Checking", type: "checking", currency: "USD" })
    .returning();
  await settle();
  received = [];
  const tx = (createdBy: string | null = user!.id) => ({
    householdId: household!.id,
    accountId: account!.id,
    amountMinor: -500,
    occurredOn: "2026-01-02",
    description: "Coffee",
    createdBy,
  });
  return { userId: user!.id, householdId: household!.id, tx };
}

describe("change notifications (LISTEN ledgerly_events)", () => {
  it("announces WHAT changed, WHERE, and WHO did it — not the data", async () => {
    const { userId, householdId, tx } = await fixture();
    await db.insert(transactions).values(tx());
    await settle();
    expect(received).toEqual([
      { t: "transactions", op: "insert", h: householdId, n: 1, a: [userId] },
    ]);
  });

  it("sends ONE message for a 1,000-row statement", async () => {
    const { tx } = await fixture();
    await db.insert(transactions).values(Array.from({ length: 1000 }, () => tx()));
    await settle();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ t: "transactions", n: 1000 });
  });

  it("says nothing about a change that was rolled back", async () => {
    const { tx } = await fixture();
    await db
      .transaction(async (t) => {
        await t.insert(transactions).values(tx());
        throw new Error("abort");
      })
      .catch(() => {});
    await settle();
    expect(received).toEqual([]);
  });

  it("names the users whose membership changed", async () => {
    const { userId, householdId } = await fixture();
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    await db.delete(householdMembers);
    await settle();
    expect(received).toEqual([
      { t: "household_members", op: "insert", h: householdId, u: [userId] },
      { t: "household_members", op: "delete", h: householdId, u: [userId] },
    ]);
  });

  it("addresses notifications to their user", async () => {
    const { userId, householdId } = await fixture();
    await db.insert(notifications).values({
      userId,
      householdId,
      kind: "test",
      title: "Hi",
      body: "There",
      dedupeKey: "k",
    });
    await settle();
    expect(received).toEqual([{ t: "notifications", u: userId }]);
  });
});
