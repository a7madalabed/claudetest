import { and, asc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
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

/**
 * Balance of every active account AS OF a date: opening balance + every
 * transaction dated on or before it (Stage 19: entries dated later haven't
 * happened yet). `asOf` is "YYYY-MM-DD", normally the household's today.
 */
export function getAccountBalances(db: Database, householdId: string, asOf: string) {
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
    .leftJoin(
      transactions,
      and(eq(transactions.accountId, accounts.id), lte(transactions.occurredOn, asOf)),
    )
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
    -- MATERIALIZED (Stage 12): computed ONCE. Without it, Postgres inlines this
    -- CTE into the per-month subquery below and re-aggregates the household's
    -- whole history once per month — 12× the work for a 12-month chart.
    flows as materialized (
      select date_trunc('month', t.occurred_on)::date as month, sum(t.amount_minor) as net
      from ${transactions} as t
      -- household_id on BOTH sides lets the accounts lookup use an index
      -- (it used to read every account of every household).
      join ${accounts} as a on a.id = t.account_id and a.household_id = t.household_id
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
 * The month statement's four figures, from ONE pass over the household's
 * transactions, so they can't disagree with each other (Stage 19).
 *
 *   broughtForward = opening balances + everything before `monthStart`
 *   received/spent = this month up to and including `today` (transfers excluded)
 *   netWorth       = opening balances + everything up to and including `today`
 *
 * Entries after `today` haven't happened yet and are in none of them. Every
 * account in `currency` counts, archived or not: the same rule as the net-worth
 * series. A transfer's two legs sit in the same window, so they cancel out in
 * brought forward and net worth, and are in neither received nor spent.
 */
export async function getMonthStatement(
  db: Database,
  householdId: string,
  args: { currency: string; monthStart: string; today: string },
) {
  const { rows } = await db.execute<{
    opening: string;
    before_month: string;
    received: string;
    spent: string;
    to_date: string;
  }>(sql`
    select
      (select coalesce(sum(${accounts.openingBalanceMinor}), 0)
         from ${accounts}
        where ${accounts.householdId} = ${householdId} and ${accounts.currency} = ${args.currency}) as opening,
      coalesce(sum(t.amount_minor) filter (where t.occurred_on < ${args.monthStart}::date), 0) as before_month,
      coalesce(sum(t.amount_minor) filter (
        where t.occurred_on >= ${args.monthStart}::date and t.occurred_on <= ${args.today}::date
          and t.transfer_id is null and t.amount_minor > 0), 0) as received,
      coalesce(-sum(t.amount_minor) filter (
        where t.occurred_on >= ${args.monthStart}::date and t.occurred_on <= ${args.today}::date
          and t.transfer_id is null and t.amount_minor < 0), 0) as spent,
      coalesce(sum(t.amount_minor) filter (where t.occurred_on <= ${args.today}::date), 0) as to_date
    from ${transactions} as t
    join ${accounts} as a on a.id = t.account_id and a.household_id = t.household_id
    where t.household_id = ${householdId} and a.currency = ${args.currency}`);
  const row = rows[0]!;
  const opening = Number(row.opening);
  return {
    broughtForwardMinor: opening + Number(row.before_month),
    receivedMinor: Number(row.received),
    spentMinor: Number(row.spent),
    netWorthMinor: opening + Number(row.to_date),
  };
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

/**
 * Spending per BUDGET per month in [from, to): a budget on "Food" counts its own
 * transactions AND those of its subcategories (Groceries, Coffee…). Refunds in
 * the category reduce spending, so this is NET spending.
 */
export async function getBudgetMonthlySpending(
  db: Database,
  householdId: string,
  range: { from: string; to: string },
) {
  const result = await db.execute<{ budget_id: string; month: string; spent_minor: string }>(sql`
    select b.id as budget_id, to_char(t.occurred_on, 'YYYY-MM') as month, (-sum(t.amount_minor))::bigint as spent_minor
    from budgets b
    join categories c on c.household_id = b.household_id and (c.id = b.category_id or c.parent_id = b.category_id)
    join transactions t on t.household_id = b.household_id and t.category_id = c.id
    where b.household_id = ${householdId}
      and t.occurred_on >= ${range.from}::date and t.occurred_on < ${range.to}::date
    group by b.id, to_char(t.occurred_on, 'YYYY-MM')`);
  return result.rows.map((r) => ({
    budgetId: r.budget_id,
    month: r.month,
    spentMinor: Number(r.spent_minor),
  }));
}

/**
 * An account's balance at the end of each month in [from, to) — the history behind
 * goal projections. Nothing dated on or after `to` is counted (the caller passes
 * tomorrow for "as of today"), so the current month's point is today's balance.
 */
export async function getAccountMonthEndBalances(
  db: Database,
  householdId: string,
  accountId: string,
  range: { from: string; to: string },
) {
  const result = await db.execute<{ month: string; balance_minor: string }>(sql`
    with months as (
      select generate_series(date_trunc('month', ${range.from}::date), date_trunc('month', ${range.to}::date - 1), interval '1 month')::date as month
    )
    select to_char(m.month, 'YYYY-MM') as month,
           (a.opening_balance_minor + coalesce((
              select sum(t.amount_minor) from transactions t
              where t.account_id = a.id
                and t.occurred_on < least((m.month + interval '1 month')::date, ${range.to}::date)
           ), 0))::bigint as balance_minor
    from months m
    cross join accounts a
    where a.id = ${accountId} and a.household_id = ${householdId}
    order by m.month`);
  return result.rows.map((r) => ({ month: r.month, balanceMinor: Number(r.balance_minor) }));
}

/**
 * Spending in [from, to) that NO budget covers: expense categories with no
 * budget on themselves or their parent, plus uncategorised money out (transfers
 * excluded). Net of refunds and never negative.
 */
export async function getUnbudgetedSpending(
  db: Database,
  householdId: string,
  range: { from: string; to: string },
) {
  const result = await db.execute<{ spent_minor: string }>(sql`
    select greatest(0, coalesce(-sum(t.amount_minor), 0))::bigint as spent_minor
    from transactions t
    left join categories c on c.id = t.category_id and c.household_id = t.household_id
    where t.household_id = ${householdId}
      and t.transfer_id is null
      and t.occurred_on >= ${range.from}::date and t.occurred_on < ${range.to}::date
      and (
        (c.id is null and t.amount_minor < 0)
        or (c.kind = 'expense' and not exists (
          select 1 from budgets b
          where b.household_id = t.household_id and b.category_id in (c.id, c.parent_id)
        ))
      )`);
  return Number(result.rows[0]?.spent_minor ?? 0);
}
