import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDailyCashflow, getNetWorthSeries, getSpendingBySubcategory } from "./queries.js";
import { accounts, categories, households, transactions } from "./schema.js";
import { createTestDb, truncateAll } from "./test/database.js";

const { db, close } = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => close());

async function fixture() {
  const [household] = await db.insert(households).values({ name: "Reports" }).returning();
  const h = household!.id;
  const [checking, savings, euro] = await db
    .insert(accounts)
    .values([
      {
        householdId: h,
        name: "Checking",
        type: "checking",
        currency: "USD",
        openingBalanceMinor: 100_000,
      },
      {
        householdId: h,
        name: "Savings",
        type: "savings",
        currency: "USD",
        openingBalanceMinor: 50_000,
      },
      {
        householdId: h,
        name: "Euro",
        type: "checking",
        currency: "EUR",
        openingBalanceMinor: 999_999,
      },
    ])
    .returning();
  const [food] = await db
    .insert(categories)
    .values({ householdId: h, name: "Food", kind: "expense" })
    .returning();
  const [groceries, coffee] = await db
    .insert(categories)
    .values([
      { householdId: h, parentId: food!.id, name: "Groceries", kind: "expense" },
      { householdId: h, parentId: food!.id, name: "Coffee", kind: "expense" },
    ])
    .returning();
  const t = (accountId: string, amountMinor: number, occurredOn: string, extra = {}) => ({
    householdId: h,
    accountId,
    amountMinor,
    occurredOn,
    description: "x",
    ...extra,
  });
  await db.insert(transactions).values([
    t(checking!.id, 300_000, "2026-01-01"), // salary
    t(checking!.id, -8_000, "2026-01-05", { categoryId: groceries!.id }),
    t(checking!.id, -500, "2026-01-05", { categoryId: coffee!.id }),
    t(checking!.id, -1_000, "2026-01-20", { categoryId: food!.id }), // booked on the parent itself
    // A transfer: must not change net worth, and isn't spending.
    t(checking!.id, -20_000, "2026-02-02", { transferId: "0198f000-0000-7000-8000-000000000001" }),
    t(savings!.id, 20_000, "2026-02-02", { transferId: "0198f000-0000-7000-8000-000000000001" }),
    t(checking!.id, -2_500, "2026-03-10", { categoryId: groceries!.id }),
    t(euro!.id, -50_000, "2026-03-10"), // different currency: excluded from USD net worth
  ]);
  return { h, foodId: food!.id };
}

describe("report queries", () => {
  it("net worth = opening balances + everything up to each month end; transfers cancel out", async () => {
    const { h } = await fixture();
    const series = await getNetWorthSeries(db, h, {
      from: "2025-12-01",
      to: "2026-04-01",
      currency: "USD",
    });
    expect(series).toEqual([
      { month: "2025-12", balanceMinor: 150_000 }, // opening balances only
      { month: "2026-01", balanceMinor: 150_000 + 300_000 - 8_000 - 500 - 1_000 },
      { month: "2026-02", balanceMinor: 440_500 }, // the transfer moved money, net worth unchanged
      { month: "2026-03", balanceMinor: 438_000 },
    ]);
  });

  it("drills into a category, including spending booked on the parent itself", async () => {
    const { h, foodId } = await fixture();
    const rows = await getSpendingBySubcategory(db, h, foodId, {
      from: "2026-01-01",
      to: "2026-04-01",
    });
    expect(rows.map((r) => [r.name, r.spendingMinor])).toEqual([
      ["Groceries", 10_500],
      ["Food", 1_000],
      ["Coffee", 500],
    ]);
  });

  it("daily cash flow splits money in and out, and excludes transfers", async () => {
    const { h } = await fixture();
    const days = await getDailyCashflow(db, h, { from: "2026-01-01", to: "2026-03-01" });
    expect(days).toEqual([
      { date: "2026-01-01", incomeMinor: 300_000, spendingMinor: 0 },
      { date: "2026-01-05", incomeMinor: 0, spendingMinor: 8_500 },
      { date: "2026-01-20", incomeMinor: 0, spendingMinor: 1_000 },
    ]);
  });
});
