import { createDb, runMigrations, seedDemoData, sql } from "@ledgerly/db";
import {
  HEAVY,
  HEAVY_TRANSACTIONS,
  HOUSEHOLDS,
  PERF_DATABASE_URL,
  TYPICAL_TRANSACTIONS,
  tokenFor,
} from "./env.js";

/*
 * Builds a LARGE, realistic dataset in its own database (ledgerly_perf):
 *
 *   · 1,000 households, each with an owner, 4 accounts, a category tree,
 *     6 budgets, a goal and two years of transactions
 *   · 990 "typical" households with ~1,500 transactions
 *   · 10 "heavy" households with ~50,000 (a busy small business)
 *   · ≈ 2 million transactions in total, plus the normal demo household
 *
 * Rows are generated INSIDE Postgres with generate_series — one INSERT …
 * SELECT creates thousands of rows without any round-trips. That's how you
 * load millions of rows in seconds instead of hours.
 *
 * Ids are derived from perf_uuid('household-42'), so they're deterministic:
 * every run produces the same ids, and the load test can compute them.
 */

const { db, close } = createDb({
  connectionString: PERF_DATABASE_URL,
  maxConnections: 2,
  statementTimeoutMs: 0,
});
const started = performance.now();
const step = async (label: string, work: () => Promise<unknown>) => {
  const t = performance.now();
  await work();
  console.log(`  ${label.padEnd(44)} ${((performance.now() - t) / 1000).toFixed(1).padStart(6)} s`);
};

const CATEGORIES: Array<{
  key: string;
  name: string;
  kind: "income" | "expense";
  parent?: string;
}> = [
  { key: "salary", name: "Salary", kind: "income" },
  { key: "freelance", name: "Freelance", kind: "income" },
  { key: "housing", name: "Housing", kind: "expense" },
  { key: "rent", name: "Rent", kind: "expense", parent: "housing" },
  { key: "utilities", name: "Utilities", kind: "expense", parent: "housing" },
  { key: "food", name: "Food", kind: "expense" },
  { key: "groceries", name: "Groceries", kind: "expense", parent: "food" },
  { key: "dining", name: "Dining out", kind: "expense", parent: "food" },
  { key: "coffee", name: "Coffee", kind: "expense", parent: "food" },
  { key: "transport", name: "Transport", kind: "expense" },
  { key: "fuel", name: "Fuel", kind: "expense", parent: "transport" },
  { key: "rideshare", name: "Rideshare", kind: "expense", parent: "transport" },
  { key: "shopping", name: "Shopping", kind: "expense" },
  { key: "health", name: "Health", kind: "expense" },
  { key: "entertainment", name: "Entertainment", kind: "expense" },
  { key: "streaming", name: "Streaming", kind: "expense", parent: "entertainment" },
  { key: "events", name: "Events", kind: "expense", parent: "entertainment" },
  { key: "travel", name: "Travel", kind: "expense" },
];
const SPENDING = [
  "utilities",
  "groceries",
  "groceries",
  "groceries",
  "dining",
  "coffee",
  "coffee",
  "fuel",
  "rideshare",
  "shopping",
  "health",
  "streaming",
  "events",
  "travel",
];
const MERCHANTS = [
  "Trader Joe's",
  "Whole Foods",
  "Safeway",
  "Blue Bottle",
  "Philz Coffee",
  "Uber",
  "Lyft",
  "Shell",
  "Chevron",
  "Amazon",
  "Target",
  "IKEA",
  "CVS",
  "Walgreens",
  "Netflix",
  "Spotify",
  "AMC Theatres",
  "Ticketmaster",
  "United Airlines",
  "Airbnb",
  "PG&E",
  "Comcast",
  "Sushi Zen",
  "Chipotle",
  "Sweetgreen",
  "Costco",
  "Home Depot",
  "Apple Store",
  "REI",
  "Etsy",
];

const id = (prefix: string) => sql.raw(`perf_uuid('${prefix}-' || g)`);
const literal = (values: string[]) =>
  sql.raw(`array[${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")}]`);

console.log(`Building the perf dataset in ${new URL(PERF_DATABASE_URL).pathname.slice(1)}…`);

await step("migrate", () => runMigrations(PERF_DATABASE_URL));
await step("wipe", async () => {
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  await db.execute(
    sql.raw(
      `truncate table ${tables.rows.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`,
    ),
  );
});
await step("demo household (for browser measurements)", () => seedDemoData(db));

// Deterministic ids that are still VALID UUIDs: an md5 hash with the version
// (4) and variant bits set. Plain md5(…)::uuid isn't a valid v4 UUID, and the
// API's strict id validation rightly rejected every request in the first run.
await step("perf_uuid() helper", () =>
  db.execute(sql`
    create or replace function perf_uuid(t text) returns uuid language sql immutable as
    $$ select overlay(overlay(md5(t) placing '4' from 13) placing '8' from 17)::uuid $$`),
);

await step(`${HOUSEHOLDS} households, users, members`, async () => {
  await db.execute(sql`
    create temporary table perf_households as
    select g, ${id("household")} as household_id, ${id("user")} as user_id,
           (case when g <= ${HEAVY}::int then ${HEAVY_TRANSACTIONS}::int else ${TYPICAL_TRANSACTIONS}::int end) as tx_count
    from generate_series(1, ${HOUSEHOLDS}) g`);
  await db.execute(sql`
    insert into users (id, email, display_name)
    select user_id, 'perf' || g || '@example.com', 'Perf User ' || g from perf_households`);
  await db.execute(sql`
    insert into households (id, name, base_currency, time_zone)
    select household_id, 'Perf Household ' || g, 'USD', 'America/New_York' from perf_households`);
  await db.execute(sql`
    insert into household_members (household_id, user_id, role)
    select household_id, user_id, 'owner' from perf_households`);
});

await step("accounts and categories", async () => {
  await db.execute(sql`
    insert into accounts (id, household_id, name, type, currency, opening_balance_minor)
    select perf_uuid('account-' || g || '-' || a.key), household_id, a.name, a.type::account_type, 'USD', a.opening
    from perf_households
    cross join (values ('checking', 'Checking', 'checking', 250000),
                       ('savings', 'Savings', 'savings', 1000000),
                       ('card', 'Credit Card', 'credit_card', 0),
                       ('cash', 'Cash', 'cash', 10000)) as a(key, name, type, opening)`);
  const values = CATEGORIES.map(
    (c, i) =>
      `('${c.key}', '${c.name.replace(/'/g, "''")}', '${c.kind}', ${c.parent ? `'${c.parent}'` : "null"}, ${i})`,
  ).join(", ");
  await db.execute(
    sql.raw(`
    insert into categories (id, household_id, parent_id, name, kind, sort_order)
    select perf_uuid('category-' || g || '-' || c.key), household_id,
           case when c.parent is null then null else perf_uuid('category-' || g || '-' || c.parent) end,
           c.name, c.kind::category_kind, c.sort
    from perf_households cross join (values ${values}) as c(key, name, kind, parent, sort)
    order by c.parent nulls first`),
  );
});

await step(
  `transactions (${(HEAVY * HEAVY_TRANSACTIONS + (HOUSEHOLDS - HEAVY) * TYPICAL_TRANSACTIONS).toLocaleString("en-US")} spending + income)`,
  async () => {
    // In batches of 50 households: one giant statement would build a 2-million-row
    // transition table for the statement-level triggers (Stages 10–11).
    for (let first = 1; first <= HOUSEHOLDS; first += 50) {
      await db.execute(sql`
      insert into transactions (id, household_id, account_id, category_id, amount_minor, occurred_on, description, created_by)
      select gen_random_uuid(), h.household_id,
             perf_uuid('account-' || h.g || '-' || (array['checking','card','card','cash'])[1 + floor(random() * 4)::int]),
             perf_uuid('category-' || h.g || '-' || (${literal(SPENDING)})[1 + floor(random() * ${SPENDING.length})::int]),
             -(300 + floor(random() * random() * 20000))::bigint,
             current_date - floor(random() * 730)::int,
             (${literal(MERCHANTS)})[1 + floor(random() * ${MERCHANTS.length})::int],
             h.user_id
      from perf_households h
      cross join lateral generate_series(1, h.tx_count - 72) s
      where h.g between ${first} and ${first + 49}`);
    }
    // Income twice a month and rent monthly, for 24 months.
    await db.execute(sql`
    insert into transactions (id, household_id, account_id, category_id, amount_minor, occurred_on, description, created_by)
    select gen_random_uuid(), household_id, perf_uuid('account-' || g || '-checking'),
           perf_uuid('category-' || g || '-' || kind), amount,
           (date_trunc('month', current_date) - (m || ' months')::interval + (d - 1 || ' days')::interval)::date,
           label, user_id
    from perf_households
    cross join generate_series(0, 23) m
    cross join (values ('salary', 1, 300000, 'Salary — Acme Inc.'), ('salary', 15, 300000, 'Salary — Acme Inc.'),
                       ('rent', 1, -180000, 'Rent')) as x(kind, d, amount, label)`);
  },
);

await step("budgets and goals", async () => {
  await db.execute(sql`
    insert into budgets (id, household_id, category_id, start_month, rollover)
    select perf_uuid('budget-' || g || '-' || b.key), household_id, perf_uuid('category-' || g || '-' || b.key),
           date_trunc('month', current_date - interval '12 months')::date, b.rollover
    from perf_households cross join (values ('groceries', true), ('dining', false), ('coffee', true),
                                            ('shopping', false), ('entertainment', false), ('utilities', false)) as b(key, rollover)`);
  await db.execute(sql`
    insert into budget_amounts (budget_id, effective_month, amount_minor)
    select perf_uuid('budget-' || g || '-' || b.key), date_trunc('month', current_date - interval '12 months')::date, b.amount
    from perf_households cross join (values ('groceries', 60000), ('dining', 25000), ('coffee', 6000),
                                            ('shopping', 20000), ('entertainment', 10000), ('utilities', 15000)) as b(key, amount)`);
  await db.execute(sql`
    insert into goals (id, household_id, account_id, name, target_minor, target_date)
    select perf_uuid('goal-' || g), household_id, perf_uuid('account-' || g || '-savings'), 'Emergency fund', 5000000,
           (current_date + interval '1 year')::date
    from perf_households`);
});

await step("sessions (so the load test can sign in instantly)", async () => {
  for (let g = 1; g <= HOUSEHOLDS; g++) {
    await db.execute(sql`
      insert into sessions (id, user_id, token_hash, expires_at)
      values (perf_uuid(${`session-${g}`}), perf_uuid(${`user-${g}`}),
              encode(sha256(convert_to(${tokenFor(g)}, 'UTF8')), 'hex'), now() + interval '30 days')`);
  }
});

// The background jobs our triggers queued while loading aren't part of the test.
await step("clear queued jobs", () => db.execute(sql`delete from jobs`));
// After a bulk load, refresh the planner's statistics — or it plans with stale guesses.
await step("vacuum analyze", () => db.execute(sql`vacuum analyze`));

const [counts] = (
  await db.execute<{ transactions: string; size: string }>(sql`
    select (select count(*) from transactions) as transactions,
           pg_size_pretty(pg_database_size(current_database())) as size`)
).rows;
console.log(
  `\n✅ ${Number(counts!.transactions).toLocaleString("en-US")} transactions, database ${counts!.size}, ${((performance.now() - started) / 1000).toFixed(0)} s total`,
);
await close();
