import { and, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
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

/**
 * Spending inside ONE top-level category, split by subcategory (the drill-down
 * from "Food" into "Groceries / Dining out / Coffee"). Spending booked directly
 * on the parent itself appears as its own row.
 */
export function getSpendingBySubcategory(
  db: Database,
  householdId: string,
  parentId: string,
  range: { from: string; to: string },
) {
  return db
    .select({
      categoryId: categories.id,
      name: categories.name,
      icon: categories.icon,
      spendingMinor: sql<number>`(-sum(${transactions.amountMinor}))::bigint`.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(categories.householdId, householdId),
        or(eq(categories.id, parentId), eq(categories.parentId, parentId)),
        gte(transactions.occurredOn, range.from),
        lt(transactions.occurredOn, range.to),
      ),
    )
    .groupBy(categories.id)
    .orderBy(sql`4 desc`);
}

/**
 * Net worth at the END of each month in [from, to): every account's opening
 * balance plus every transaction up to that month. Transfers between our own
 * accounts cancel out automatically (−X here, +X there).
 *
 * One currency at a time (the household's base currency): adding dollars to
 * euros without exchange rates would produce a meaningless number.
 */
export async function getNetWorthSeries(
  db: Database,
  householdId: string,
  range: { from: string; to: string; currency: string },
) {
  const result = await db.execute<{ month: string; balance_minor: string }>(sql`
    with months as (
      select generate_series(
        date_trunc('month', ${range.from}::date),
        date_trunc('month', ${range.to}::date - 1),
        interval '1 month'
      )::date as month
    ),
    opening as (
      select coalesce(sum(${accounts.openingBalanceMinor}), 0) as total
      from ${accounts}
      where ${accounts.householdId} = ${householdId} and ${accounts.currency} = ${range.currency}
    ),
    flows as (
      select date_trunc('month', t.occurred_on)::date as month, sum(t.amount_minor) as net
      from ${transactions} as t
      join ${accounts} as a on a.id = t.account_id
      where t.household_id = ${householdId} and a.currency = ${range.currency} and t.occurred_on < ${range.to}::date
      group by 1
    )
    select to_char(m.month, 'YYYY-MM') as month,
           (o.total + coalesce((select sum(f.net) from flows f where f.month <= m.month), 0))::bigint as balance_minor
    from months m cross join opening o
    order by m.month`);
  return result.rows.map((row) => ({ month: row.month, balanceMinor: Number(row.balance_minor) }));
}

/**
 * Money in and out per calendar day in [from, to), same definitions as the
 * monthly cash-flow report (transfers excluded). Days with no activity are omitted.
 */
export function getDailyCashflow(
  db: Database,
  householdId: string,
  range: { from: string; to: string },
) {
  return db
    .select({
      date: transactions.occurredOn,
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
        isNull(transactions.transferId),
        gte(transactions.occurredOn, range.from),
        lt(transactions.occurredOn, range.to),
      ),
    )
    .groupBy(transactions.occurredOn)
    .orderBy(transactions.occurredOn);
}
