import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "./client.js";
import { accounts, categories, transactions } from "./schema.js";

/*
 * Reusable read queries. Two details matter everywhere below:
 *
 * 1. SUM() of a bigint returns Postgres `numeric` (it could overflow bigint), and
 *    the pg driver returns numeric as a STRING to avoid precision loss. We cast the
 *    result back to bigint and map it to a JS number with `.mapWith(Number)`.
 * 2. Every query is scoped by household_id — the first column of our indexes.
 *
 * Note: sums across accounts assume one currency. Multi-currency conversion to
 * the household's base currency is a later concern (documented in the Stage 3 doc).
 */

/** Current balance of every active account: opening balance + all transactions. */
export function getAccountBalances(db: Database, householdId: string) {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
      balanceMinor:
        sql<number>`(${accounts.openingBalanceMinor} + coalesce(sum(${transactions.amountMinor}), 0))::bigint`.mapWith(
          Number,
        ),
      transactionCount: sql<number>`count(${transactions.id})::int`.mapWith(Number),
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(and(eq(accounts.householdId, householdId), isNull(accounts.archivedAt)))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.name));
}

/** Income and spending per calendar month in [from, to). Dates are "YYYY-MM-DD". */
export function getMonthlyCashflow(
  db: Database,
  householdId: string,
  range: { from: string; to: string },
) {
  const month = sql<string>`to_char(${transactions.occurredOn}, 'YYYY-MM')`;
  return db
    .select({
      month,
      incomeMinor:
        sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.amountMinor} > 0), 0)::bigint`.mapWith(
          Number,
        ),
      spendingMinor:
        sql<number>`coalesce(-sum(${transactions.amountMinor}) filter (where ${transactions.amountMinor} < 0), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.transferId), // moving money between own accounts isn't income
        gte(transactions.occurredOn, range.from),
        lt(transactions.occurredOn, range.to),
      ),
    )
    .groupBy(month)
    .orderBy(month);
}

/**
 * Spending grouped by TOP-LEVEL category ("Food", not "Groceries") in [from, to).
 * Uses a self-join: each category is joined to its root (its parent, or itself).
 */
export function getSpendingByCategory(
  db: Database,
  householdId: string,
  range: { from: string; to: string },
) {
  const root = alias(categories, "root_category");
  return db
    .select({
      categoryId: root.id,
      name: root.name,
      icon: root.icon,
      spendingMinor: sql<number>`(-sum(${transactions.amountMinor}))::bigint`.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(root, eq(root.id, sql`coalesce(${categories.parentId}, ${categories.id})`))
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(categories.kind, "expense"),
        gte(transactions.occurredOn, range.from),
        lt(transactions.occurredOn, range.to),
      ),
    )
    .groupBy(root.id)
    .orderBy(sql`4 desc`);
}
