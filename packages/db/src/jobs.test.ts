import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, households, jobs, recurringRules, transactions } from "./schema.js";
import { createTestDb, truncateAll } from "./test/database.js";

const { db, close } = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => close());

const today = () => new Date().toISOString().slice(0, 10);

async function fixture() {
  const [household] = await db
    .insert(households)
    .values({ name: "Jobs", timeZone: "UTC" })
    .returning();
  const [account] = await db
    .insert(accounts)
    .values({ householdId: household!.id, name: "Checking", type: "checking", currency: "USD" })
    .returning();
  const tx = (occurredOn: string, extra: Partial<typeof transactions.$inferInsert> = {}) => ({
    householdId: household!.id,
    accountId: account!.id,
    amountMinor: -1_000,
    occurredOn,
    description: "Coffee",
    ...extra,
  });
  return { householdId: household!.id, accountId: account!.id, tx };
}

const budgetJobs = () => db.select().from(jobs).where(eq(jobs.name, "budgets.evaluate"));

describe("budget evaluation trigger", () => {
  it("queues ONE job per household-month, however many rows or statements", async () => {
    const { householdId, tx } = await fixture();
    await db.insert(transactions).values([tx(today()), tx(today()), tx(today())]);
    await db.insert(transactions).values(tx(today()));
    await db.update(transactions).set({ amountMinor: -2_000 });

    const queued = await budgetJobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toEqual({ householdId, month: today().slice(0, 7) });
    // Debounced: it waits a moment for a burst of edits to settle.
    expect(queued[0]!.runAt.getTime()).toBeGreaterThan(queued[0]!.createdAt.getTime());
  });

  it("ignores changes to months other than the household's current one", async () => {
    const { tx } = await fixture();
    await db.insert(transactions).values(tx("2020-01-15"));
    expect(await budgetJobs()).toHaveLength(0);
  });

  it("rolls back with the change that caused it", async () => {
    const { tx } = await fixture();
    await db
      .transaction(async (t) => {
        await t.insert(transactions).values(tx(today()));
        throw new Error("abort");
      })
      .catch(() => {});
    expect(await budgetJobs()).toHaveLength(0);
  });

  it("queues a fresh job once the previous one has started running", async () => {
    const { tx } = await fixture();
    await db.insert(transactions).values(tx(today()));
    await db.update(jobs).set({ status: "running" });
    await db.insert(transactions).values(tx(today()));
    expect(await budgetJobs()).toHaveLength(2);
  });
});

describe("duplicate guards", () => {
  it("never stores the same imported bank row twice in one account", async () => {
    const { tx } = await fixture();
    await db.insert(transactions).values(tx(today(), { importFingerprint: "abc" }));
    const again = await db
      .insert(transactions)
      .values(tx(today(), { importFingerprint: "abc" }))
      .onConflictDoNothing()
      .returning();
    expect(again).toHaveLength(0);
  });

  it("lets a recurring rule create at most one transaction per due date", async () => {
    const { householdId, accountId, tx } = await fixture();
    const [rule] = await db
      .insert(recurringRules)
      .values({
        householdId,
        accountId,
        description: "Rent",
        amountMinor: -100_000,
        cadence: "monthly",
        anchorDay: 1,
        nextDate: "2026-07-01",
      })
      .returning();
    await db.insert(transactions).values(tx("2026-07-01", { recurringRuleId: rule!.id }));
    await expect(
      db.insert(transactions).values(tx("2026-07-01", { recurringRuleId: rule!.id })),
    ).rejects.toThrow();
  });

  it("checks that a rule's days fit its cadence", async () => {
    const { householdId, accountId } = await fixture();
    await expect(
      db.execute(sql`insert into recurring_rules (id, household_id, account_id, description, amount_minor, cadence, anchor_day, next_date)
                     values (gen_random_uuid(), ${householdId}, ${accountId}, 'Bad', -1, 'weekly', 3, '2026-07-01')`),
    ).rejects.toThrow();
  });
});
