/**
 * Integration tests: these run against a REAL PostgreSQL database (not mocks),
 * because what we're testing — constraints, foreign keys, triggers, SQL — only
 * exists inside Postgres.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { isPgError } from "./errors.js";
import { getAccountBalances, getMonthlyCashflow, getSpendingByCategory } from "./queries.js";
import {
  accounts,
  categories,
  householdMembers,
  households,
  transactions,
  users,
} from "./schema.js";
import { seedDemoData } from "./seed.js";
import { createTestDb, truncateAll } from "./test/database.js";

const { db, close } = createTestDb();

beforeEach(() => truncateAll(db));
afterAll(() => close());

/** Creates a household with one account and one expense category. */
async function makeHousehold(name = "Test household") {
  const [household] = await db.insert(households).values({ name }).returning();
  const [account] = await db
    .insert(accounts)
    .values({ householdId: household!.id, name: "Checking", type: "checking", currency: "USD" })
    .returning();
  const [category] = await db
    .insert(categories)
    .values({ householdId: household!.id, name: "Food", kind: "expense" })
    .returning();
  return { household: household!, account: account!, category: category! };
}

/** Runs `fn` and returns the error it throws (fails the test if it doesn't throw). */
async function errorFrom(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the database to reject this, but it succeeded");
}

describe("data types", () => {
  it("round-trips money as exact integers and dates as plain strings", async () => {
    const { household, account } = await makeHousehold();
    const [row] = await db
      .insert(transactions)
      .values({
        householdId: household.id,
        accountId: account.id,
        amountMinor: -9_007_199_254_740_991, // Number.MIN_SAFE_INTEGER: still exact
        occurredOn: "2026-02-28",
        description: "Edge case",
      })
      .returning();

    expect(row!.amountMinor).toBe(-9_007_199_254_740_991);
    expect(row!.occurredOn).toBe("2026-02-28"); // a string — no time-zone shifting
    expect(row!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("generates time-ordered UUID v7 ids", async () => {
    const first = await makeHousehold("First");
    const second = await makeHousehold("Second");
    expect(first.household.id < second.household.id).toBe(true);
  });
});

describe("constraints protect data integrity", () => {
  it("rejects a transaction that points to ANOTHER household's account", async () => {
    const mine = await makeHousehold("Mine");
    const theirs = await makeHousehold("Theirs");

    const error = await errorFrom(() =>
      db.insert(transactions).values({
        householdId: mine.household.id,
        accountId: theirs.account.id, // ← cross-tenant reference
        amountMinor: -100,
        occurredOn: "2026-01-01",
        description: "Sneaky",
      }),
    );
    expect(isPgError(error, "foreignKeyViolation", "transactions_account_fkey")).toBe(true);
  });

  it("rejects a zero amount", async () => {
    const { household, account } = await makeHousehold();
    const error = await errorFrom(() =>
      db.insert(transactions).values({
        householdId: household.id,
        accountId: account.id,
        amountMinor: 0,
        occurredOn: "2026-01-01",
        description: "Nothing",
      }),
    );
    expect(isPgError(error, "checkViolation", "transactions_amount_not_zero")).toBe(true);
  });

  it("rejects an invalid currency code", async () => {
    const error = await errorFrom(() =>
      db.insert(households).values({ name: "Bad", baseCurrency: "usd" }),
    );
    expect(isPgError(error, "checkViolation")).toBe(true);
  });

  it("treats emails as case-insensitive and unique", async () => {
    await db.insert(users).values({ email: "alex@example.com", displayName: "Alex" });
    const error = await errorFrom(() =>
      db.insert(users).values({ email: "ALEX@example.com", displayName: "Impostor" }),
    );
    expect(isPgError(error, "uniqueViolation", "users_email_lower_key")).toBe(true);
  });

  it("forbids duplicate category names among siblings, including at the top level", async () => {
    const { household, category } = await makeHousehold();
    // Top level: parent_id IS NULL for both — NULLS NOT DISTINCT makes this a duplicate.
    const topLevel = await errorFrom(() =>
      db.insert(categories).values({ householdId: household.id, name: "Food", kind: "expense" }),
    );
    expect(isPgError(topLevel, "uniqueViolation")).toBe(true);

    // Same name under different parents is fine ("Food › Other" and "Travel › Other").
    const [travel] = await db
      .insert(categories)
      .values({ householdId: household.id, name: "Travel", kind: "expense" })
      .returning();
    await db.insert(categories).values([
      { householdId: household.id, parentId: category.id, name: "Other", kind: "expense" },
      { householdId: household.id, parentId: travel!.id, name: "Other", kind: "expense" },
    ]);
  });

  it("does not allow a transfer to have a category", async () => {
    const { household, account, category } = await makeHousehold();
    const error = await errorFrom(() =>
      db.insert(transactions).values({
        householdId: household.id,
        accountId: account.id,
        categoryId: category.id,
        transferId: crypto.randomUUID(),
        amountMinor: -500,
        occurredOn: "2026-01-01",
        description: "Transfer",
      }),
    );
    expect(isPgError(error, "checkViolation", "transactions_transfer_has_no_category")).toBe(true);
  });
});

describe("deleting data", () => {
  it("blocks deleting an account that still has transactions", async () => {
    const { household, account } = await makeHousehold();
    await db.insert(transactions).values({
      householdId: household.id,
      accountId: account.id,
      amountMinor: -100,
      occurredOn: "2026-01-01",
      description: "Coffee",
    });
    const error = await errorFrom(() => db.delete(accounts).where(eq(accounts.id, account.id)));
    expect(isPgError(error, "foreignKeyViolation")).toBe(true);
  });

  it("deleting a household removes all of its data (and nothing else)", async () => {
    const doomed = await makeHousehold("Doomed");
    const survivor = await makeHousehold("Survivor");
    for (const { household, account } of [doomed, survivor]) {
      await db.insert(transactions).values({
        householdId: household.id,
        accountId: account.id,
        amountMinor: -100,
        occurredOn: "2026-01-01",
        description: "Coffee",
      });
    }

    await db.delete(households).where(eq(households.id, doomed.household.id));

    const remaining = await db.select({ householdId: transactions.householdId }).from(transactions);
    expect(remaining).toEqual([{ householdId: survivor.household.id }]);
    expect(await db.$count(accounts)).toBe(1);
    expect(await db.$count(categories)).toBe(1);
  });
});

describe("updated_at trigger", () => {
  it("bumps updated_at when a row changes, but not on a no-op update", async () => {
    const { household } = await makeHousehold("Before");
    // Inside one transaction now() is frozen, so separate statements are needed.
    const read = async () =>
      (await db.select().from(households).where(eq(households.id, household.id)))[0]!;

    await db.execute(sql`select pg_sleep(0.01)`);
    await db.update(households).set({ name: "Before" }).where(eq(households.id, household.id));
    expect((await read()).updatedAt).toEqual(household.updatedAt);

    await db.update(households).set({ name: "After" }).where(eq(households.id, household.id));
    expect((await read()).updatedAt.getTime()).toBeGreaterThan(household.updatedAt.getTime());
  });
});

describe("queries", () => {
  async function fixture() {
    const { household, account, category } = await makeHousehold();
    const [savings] = await db
      .insert(accounts)
      .values({
        householdId: household.id,
        name: "Savings",
        type: "savings",
        currency: "USD",
        openingBalanceMinor: 10_000,
      })
      .returning();
    const [groceries] = await db
      .insert(categories)
      .values({
        householdId: household.id,
        parentId: category.id,
        name: "Groceries",
        kind: "expense",
      })
      .returning();
    const [salary] = await db
      .insert(categories)
      .values({ householdId: household.id, name: "Salary", kind: "income" })
      .returning();
    const transferId = crypto.randomUUID();
    const base = { householdId: household.id, description: "x" };
    await db.insert(transactions).values([
      {
        ...base,
        accountId: account.id,
        categoryId: salary!.id,
        amountMinor: 300_000,
        occurredOn: "2026-03-01",
      },
      {
        ...base,
        accountId: account.id,
        categoryId: groceries!.id,
        amountMinor: -4_550,
        occurredOn: "2026-03-03",
      },
      {
        ...base,
        accountId: account.id,
        categoryId: category.id,
        amountMinor: -1_200,
        occurredOn: "2026-03-20",
      },
      {
        ...base,
        accountId: account.id,
        categoryId: groceries!.id,
        amountMinor: -9_999,
        occurredOn: "2026-04-02",
      },
      // A transfer: should move balances but NOT count as income or spending.
      {
        ...base,
        accountId: account.id,
        transferId,
        amountMinor: -50_000,
        occurredOn: "2026-03-05",
      },
      {
        ...base,
        accountId: savings!.id,
        transferId,
        amountMinor: 50_000,
        occurredOn: "2026-03-05",
      },
    ]);
    return household.id;
  }

  it("computes account balances including the opening balance", async () => {
    const householdId = await fixture();
    const balances = await getAccountBalances(db, householdId);
    expect(balances.map((b) => [b.name, b.balanceMinor])).toEqual([
      ["Checking", 300_000 - 4_550 - 1_200 - 9_999 - 50_000],
      ["Savings", 10_000 + 50_000],
    ]);
  });

  it("computes monthly cashflow, excluding transfers", async () => {
    const householdId = await fixture();
    const cashflow = await getMonthlyCashflow(db, householdId, {
      from: "2026-03-01",
      to: "2026-05-01",
    });
    expect(cashflow).toEqual([
      { month: "2026-03", incomeMinor: 300_000, spendingMinor: 5_750 },
      { month: "2026-04", incomeMinor: 0, spendingMinor: 9_999 },
    ]);
  });

  it("rolls subcategory spending up into the top-level category", async () => {
    const householdId = await fixture();
    const spending = await getSpendingByCategory(db, householdId, {
      from: "2026-03-01",
      to: "2026-04-01",
    });
    expect(spending.map((s) => [s.name, s.spendingMinor])).toEqual([["Food", 5_750]]);
  });

  it("never leaks data between households", async () => {
    const householdId = await fixture();
    const other = await makeHousehold("Other");
    expect(await getAccountBalances(db, other.household.id)).toHaveLength(1);
    expect(await getAccountBalances(db, householdId)).toHaveLength(2);
  });
});

describe("seed data", () => {
  it("is deterministic and internally consistent", async () => {
    const first = await seedDemoData(db, { today: "2026-06-15", seed: 7 });
    const balances = await getAccountBalances(db, first.householdId);
    const members = await db.select().from(householdMembers);

    await truncateAll(db);
    const second = await seedDemoData(db, { today: "2026-06-15", seed: 7 });
    const balancesAgain = await getAccountBalances(db, second.householdId);

    expect(second.transactionCount).toBe(first.transactionCount);
    expect(balancesAgain.map((b) => b.balanceMinor)).toEqual(balances.map((b) => b.balanceMinor));
    // A shared household: the demo owner and their partner (an editor).
    expect(members.map((m) => m.role).sort()).toEqual(["editor", "owner"]);

    // Every transfer is a balanced pair: the two halves sum to exactly zero.
    const unbalanced = await db.execute(sql`
      select transfer_id from transactions where transfer_id is not null
      group by transfer_id having count(*) <> 2 or sum(amount_minor) <> 0`);
    expect(unbalanced.rows).toHaveLength(0);

    // No transactions in the future.
    const future = await db.execute(
      sql`select 1 from transactions where occurred_on > '2026-06-15'`,
    );
    expect(future.rows).toHaveLength(0);
  });
});
