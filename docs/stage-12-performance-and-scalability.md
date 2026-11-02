# Stage 12 — Performance & Scalability

> **Goal of this stage:** find out how fast Ledgerly really is, at a size much larger than the demo; fix what the numbers say is slow; and estimate how many households one server can carry.
>
> **What you'll learn:** performance work as a **measurement discipline**: build realistic data, load-test the production build, read percentiles, then find the cause with query statistics, query plans and CPU profiles. You'll also learn to fix one thing at a time and re-measure, and to tell a real change from noise. Along the way: Postgres JIT, CTE inlining, prepared statements, connection-pool sizing, version-keyed caching with ETags, event-loop blocking, and Core Web Vitals.

---

## Table of contents

1. [What we built](#1-what-we-built)
2. [The method](#2-the-method)
3. [A realistic dataset](#3-a-realistic-dataset)
4. [The load test](#4-the-load-test)
5. [The baseline](#5-the-baseline)
6. [Finding #1: the JIT compiler](#6-finding-1-the-jit-compiler)
7. [Finding #2: a CTE that ran twelve times](#7-finding-2-a-cte-that-ran-twelve-times)
8. [Finding #3: blocking the event loop](#8-finding-3-blocking-the-event-loop)
9. [Caching, keyed by a data version](#9-caching-keyed-by-a-data-version)
10. [Finding #4: the cost of every request](#10-finding-4-the-cost-of-every-request)
11. [Connection pool size: an experiment](#11-connection-pool-size-an-experiment)
12. [Measuring honestly](#12-measuring-honestly)
13. [The front end](#13-the-front-end)
14. [Results](#14-results)
15. [Capacity: how many households per server?](#15-capacity-how-many-households-per-server)
16. [What testing and looking caught](#16-what-testing-and-looking-caught)
17. [Run it yourself](#17-run-it-yourself)
18. [Exercises](#18-exercises)
19. [Glossary](#19-glossary)
20. [What's next](#20-whats-next)

---

## 1. What we built

| Area         | What's new                                                                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/perf` | A new workspace package: a **2-million-transaction dataset** generator, a launcher for the **production** API, a **load tester** (autocannon) with a before/after comparer, and a **browser** Web Vitals measurement with **performance budgets**. |
| Database     | `jit = off` for the app's connections; the net-worth query rewritten (`MATERIALIZED`, household-scoped join); a **per-household data version** maintained by triggers; `pg_stat_statements` enabled (Compose + local).                             |
| API          | A **response cache + ETags** keyed by that version; **prepared statements** for the two queries every request runs; quadratic grouping in recurring detection fixed.                                                                               |
| Web          | Charts reserve their height (layout shift 0.106 → 0.002); the ⌘K palette loads on demand; the page entrance is a CSS animation, so server-rendered content isn't hidden until JavaScript runs.                                                     |

The overall result for heavy households (50,000 transactions), at p99:

| Endpoint             | Before   | After (cache miss)  | After (cache hit) |
| -------------------- | -------- | ------------------- | ----------------- |
| Net worth, 12 months | 4,989 ms | 279 ms              | 9 ms              |
| Goals                | 1,498 ms | 32 ms               | 9 ms              |
| Recurring bills      | 2,241 ms | 2,668 ms            | 9 ms              |
| Budgets              | 171 ms   | 233 ms (noise, §12) | 9 ms              |

The rest of this document explains how we found each number, and why the recurring-bills miss is still slow.

---

## 2. The method

Performance work goes wrong in predictable ways: optimising code that isn't slow, measuring a development build, testing with ten rows of data, or believing a number that's really noise. The procedure we followed:

1. **Realistic data.** Most queries are fast on the demo's 430 transactions. Problems appear at scale, and only for some users (the "heavy" ones).
2. **Measure the production build,** started the way it runs in production. Development mode (TypeScript compiled on the fly, pretty logs) is a different program.
3. **Read percentiles, not averages.** **p50** is the typical request. **p99** is the slowest 1%, the experience of your unluckiest users on every page load. Averages hide both.
4. **Find the cause before fixing anything:** query statistics → query plans → CPU profiles.
5. **Change one thing, then measure again.** If two fixes ship together, you can't tell which one helped, or whether one of them hurt.
6. **Know your noise.** Repeat runs, and compare versions side by side in the same session.

One rule of thumb, **Little's law**, explains most of what follows:

```
concurrent requests = throughput × latency
```

With 16 requests always in flight, an endpoint that takes 16 ms can serve about 1,000 requests per second. If it takes 160 ms, it can serve only about 100.

---

## 3. A realistic dataset

`pnpm --filter @ledgerly/perf run dataset` builds a separate database, `ledgerly_perf`. The script refuses to run against any database whose name doesn't contain "perf".

| What               | How much                                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| Households         | 1,000 (each with an owner, 4 accounts, an 18-category tree, 6 budgets, a goal) |
| Typical households | 990, with ~1,500 transactions over two years                                   |
| Heavy households   | 10, with ~50,000 (a busy small business)                                       |
| Total              | **1,985,430 transactions, 632 MB**, built in **107 s**                         |

Techniques worth knowing:

- **Generate inside the database.** `INSERT … SELECT … FROM generate_series(1, 1500)` creates thousands of rows in one statement with no round-trips. That's about 19,000 rows per second here, including four indexes and our triggers.
- **Batch the big statement.** One INSERT of 2 million rows would build a 2-million-row transition table for the statement-level triggers from Stages 10–11. Batches of 50 households keep that small.
- **Deterministic ids:** `perf_uuid('household-42')` is always the same UUID, so the load test can compute ids without asking the database.
- **`VACUUM ANALYZE` after a bulk load.** The planner chooses query plans from statistics about the data. Without fresh statistics it plans for an empty table.

The first version made ids with `md5(…)::uuid`. Those are **not valid UUIDs** (the version and variant bits are random), and the API's strict validation rejected every single request. The validation was right. The fix sets the version (4) and variant bits (§16).

---

## 4. The load test

`pnpm --filter @ledgerly/perf run load -- --label baseline` tests 12 endpoints, the requests behind the dashboard and main pages:

- **16 concurrent connections, 6 seconds each, after a 1-second warm-up.** The warm-up fills caches and lets V8 optimise the hot code.
- **Requests rotate round-robin through the households:** 990 typical, then the 10 heavy ones separately.
- **The API is the production build** (`node dist/server.js`, `NODE_ENV=production`), with rate limiting off. Otherwise the load test would mostly measure 429 responses.
- **Any run with failed requests is discarded.** A failed request is a **fast** request, so a broken run looks like a great result.

That last rule exists because it happened twice. The first "results" were tens of thousands of instant 401s (production cookies have a `__Host-` prefix) and 404s (the invalid UUIDs). The runner now refuses to save a run that contains errors.

---

## 5. The baseline

Selected rows (full output in `tools/perf/results/baseline.json` when you run it):

| Endpoint             | typical p50  | typical p99 | heavy p50    | heavy p99 | heavy req/s |
| -------------------- | ------------ | ----------- | ------------ | --------- | ----------- |
| GET /me              | 15 ms        | 26 ms       | 18 ms        | 27 ms     | 857         |
| Accounts             | 17 ms        | 28 ms       | 64 ms        | 99 ms     | 244         |
| Spending by category | 29 ms        | 48 ms       | 66 ms        | 119 ms    | 232         |
| Budgets              | 31 ms        | 49 ms       | 113 ms       | 171 ms    | 137         |
| **Net worth**        | **1,396 ms** | 2,683 ms    | **3,325 ms** | 4,989 ms  | **3**       |
| **Goals**            | **817 ms**   | 1,533 ms    | **771 ms**   | 1,498 ms  | **18**      |
| **Recurring bills**  | 34 ms        | 61 ms       | **986 ms**   | 2,241 ms  | **14**      |

Most endpoints were fine. Three weren't, and two of them were slow **even for typical households** that have only 1,500 transactions. When a small household is as slow as a big one, the cost doesn't depend on that household's data.

**Where did database time go?** `pg_stat_statements` records every query shape with its call count and total time:

```
 total_s | calls | mean_ms |  pct
---------+-------+---------+------
   146.6 |   148 |   990.2 | 26.2   ← net worth
   132.2 |   313 |   422.2 | 23.6   ← account month-end balances (goals)
    69.5 |  5375 |    12.9 | 12.4   ← spending by category
```

Two queries made **0.9% of the calls and used 50% of the database's time**. That's typical: a handful of queries usually dominate, so you fix those first.

---

## 6. Finding #1: the JIT compiler

`EXPLAIN (ANALYZE)` runs a query and reports where its time went:

```
 Sort [341 ms]
   ->  Nested Loop [341 ms]
         ->  Aggregate [326 ms]
               ->  Bitmap Heap Scan on accounts [326 ms, rows 4]     ← 326 ms to read FOUR rows?
```

Reading four rows doesn't take 326 ms. The footer of the full plan said why: **JIT**. Postgres can compile a query to machine code when it _estimates_ the query is expensive (`jit_above_cost`, default 100,000). Here the estimated cost was **5.2 million**. The planner assumes a set-returning function like `generate_series` returns 1,000 rows; ours returns 12, and the per-month subquery multiplied the error. So Postgres spent about 320 ms compiling a query that runs in tens of milliseconds:

| Query                         | JIT on | JIT off     |
| ----------------------------- | ------ | ----------- |
| Net worth (typical household) | 353 ms | **27 ms**   |
| Account month-end balances    | 219 ms | **0.28 ms** |

JIT pays off for long analytical queries over millions of rows, and works against short, frequent web queries. We turned it off **for the application's connections**:

```ts
// packages/db/src/client.ts
options: "-c jit=off",
```

It's set per connection, not in `postgresql.conf`, so it works on managed databases where you can't edit the server's configuration. Re-measured: net worth went from 1,396 → **71 ms** (typical, p50) and goals from 817 → **22 ms**.

> **Best practice:** when a query is slow, read its plan before rewriting it. Here the plan pointed at a database setting, not at our SQL.

---

## 7. Finding #2: a CTE that ran twelve times

Net worth for heavy households was still about 2 seconds. The plan showed `loops=12` on the aggregation of the household's whole history. A **CTE** (`WITH flows AS (…)`) referenced from a per-month subquery gets **inlined** by Postgres (since version 12), so it re-ran once per month. One word stops that:

```sql
flows as materialized (    -- compute once, reuse 12 times
  select date_trunc('month', t.occurred_on)::date as month, sum(t.amount_minor) as net
  from transactions t
  join accounts a on a.id = t.account_id and a.household_id = t.household_id
  …
```

For a heavy household: **748 ms → 64 ms**. The second change, `a.household_id = t.household_id`, lets the join use this household's accounts via an index, instead of reading every account in the database (4,004 here; millions in production).

---

## 8. Finding #3: blocking the event loop

Recurring bills for heavy households took about a second, but the database wasn't the problem. Timing `detectRecurring()` on its own showed **38 ms of pure CPU** for 13,000 transactions.

That matters because **Node runs your request handlers on one thread**. While one request computes for 38 ms, every other request on that process waits. With 16 in flight, the queue alone adds up to about 600 ms. CPU-heavy work in a request handler slows _everyone_, not just the user who asked.

The detector had a quadratic loop:

```ts
groups.set(key, [...(groups.get(key) ?? []), t]); // copies the whole group on every row
```

With `push` instead, 38 → **18 ms**. That's still real work (normalising and sorting 13,000 rows). For a heavy household, this endpoint is the reason caching exists (next section). Moving the detection into a **background job** that stores its result would be the longer-term fix (an exercise).

---

## 9. Caching, keyed by a data version

The remaining slow responses do work that grows with the household's data. Net worth sums the whole history; recurring scans six months. They're read far more often than the data changes, which is the classic case for a cache.

The hard part of caching is **invalidation**: knowing when a cached answer is stale. We designed it so stale answers are impossible by construction:

1. **A version per household.** Migration `0012` adds triggers that bump `household_data_versions.version` once per statement that changes transactions, accounts, categories, budgets, goals or rules. The bump happens **inside the same transaction** as the change.
2. **The version comes for free.** The household-scope check (Stage 5) already runs one query per request; it now `LEFT JOIN`s the version, so there's no extra round-trip.
3. **The cache key includes the version:** `household · version · today · URL`. A write makes the version go up, so the next read computes a different key. There's no "remember to delete the cache entry" step for anyone to forget. And because the version lives in the **database**, every API instance sees it immediately. A test writes through one app instance and checks that another instance's cache misses on the next read.
4. **ETags.** The response carries `ETag: "<hash of the key>"` and `Cache-Control: private, no-cache`. That tells the browser to keep a copy but check with us before using it. When nothing has changed, we answer **304 Not Modified** with no body: no queries, and no response to serialise or send.

Only routes declared with `config: { cache: true }` are cached. These are reads whose answer is the same for every member and depends only on the household's data and the URL. Per-user data (notifications, dashboard layout, `/me`) is never cached. The membership check runs **before** the cache, so one household's cached data can never be served to a non-member (tested).

**What did the triggers cost?** Writes, measured with the trigger on and off, alternating in the same session:

```
enabled   749 · 845 · 805 writes/s
disabled  826 · 796 · 774 writes/s
```

No measurable difference. The version row is locked briefly during each write, so concurrent writes to **one** household queue for a moment. That's fine at household scale.

The trigger also had a bug, which a test caught (§16).

---

## 10. Finding #4: the cost of every request

With caching on, **every** endpoint landed at about 13 ms p50 and 1,100 requests per second. When everything costs the same, what you're measuring is the cost of **handling a request at all**. `pg_stat_statements` showed just two queries per request (session lookup and membership), at **0.02 ms each**. So the database wasn't the limit. A **CPU profile** of the API process (`node --cpu-prof`) under load showed:

```
 30.6%  drizzle-orm      ← building SQL strings
 23.4%  (native/other)
 11.6%  (idle)
  4.4%  pg
  2.0%  fastify
```

Nearly a third of the CPU went into the query builder **turning the same two queries into SQL** on every request. Postgres executed them in 0.02 ms; Node spent far longer writing them. The fix is **prepared statements**, which are built once with placeholders and then executed with new values:

```ts
const membershipStatement = preparedFor((db: Database) =>
  db.select({ … })
    .where(and(eq(householdMembers.householdId, sql.placeholder("householdId")), …))
    .prepare("household_membership"),
);
// per request:
await membershipStatement(app.db).execute({ householdId, userId });
```

Postgres also parses and plans a prepared statement once per connection. `preparedFor` caches one per database handle in a `WeakMap`, because tests create several app instances, each with its own handle.

Result on a cached endpoint: **1,105 → 2,870 requests per second**, p50 **13 → 5 ms**. Drizzle's share of the CPU fell from 31% to 5%.

> **Best practice:** profile before optimising. Nobody would have guessed "the query builder" for a database-backed API. The profile showed it in one run.

---

## 11. Connection pool size: an experiment

Intuition says more database connections means more throughput. We tested it on a database-bound endpoint (heavy households, cache off, 64 concurrent clients):

| Pool size | req/s   | p50        | p99          |
| --------- | ------- | ---------- | ------------ |
| 2         | 36      | 1,438 ms   | 2,999 ms     |
| 4         | 132     | 444 ms     | 862 ms       |
| **8**     | **190** | **320 ms** | 527 ms       |
| 16        | 187     | 329 ms     | 503 ms       |
| 32        | 167     | 353 ms     | **1,702 ms** |

Throughput peaks at about **2× the CPU cores** (this machine has 4), then **gets worse**. Beyond that point, extra connections only compete for the same CPUs, disk and locks inside Postgres; the queue just moves from the pool into the database, where it's more expensive. Our default of 10 sits on the plateau, so we kept it.

This also tells you when you'll need a **connection pooler** (PgBouncer). Postgres allows 100 connections by default, so about eight API processes with pools of 10 (plus the worker) use them up.

---

## 12. Measuring honestly

Two stories from this stage show why careful measurement matters.

**The regression that wasn't.** The final uncached run showed some heavy endpoints **15–36% slower** than the baseline, on code paths we hadn't changed. Repeating the run three times gave consistent results (±9%), so it wasn't random noise within the run. Was it the JIT change? Tested directly: JIT never even activated for those queries. Then we did the rigorous thing: built the **pre-Stage-12 code** in a separate `git worktree`, ran both versions of the API side by side against the same database, and **alternated** between them:

```
round 1  before 106 req/s   after 116 req/s
round 2  before 116 req/s   after 127 req/s
round 3  before 115 req/s   after 116 req/s
```

The old code was not faster. The "regression" was the virtual machine itself running slower an hour later. Numbers taken at different times on shared hardware aren't comparable. **A/B tests must run side by side, at the same time, on the same machine.** That's also why we report p50/p99 rather than precise milliseconds as absolute truth.

**The speed-up that wasn't.** One front-end change seemed to make pages paint **4× sooner**. It turned out the metric had picked a different element (§13). We don't publish numbers we can't explain.

---

## 13. The front end

`pnpm --filter @ledgerly/perf run web` loads each page in **real Chromium**, against `next build && next start`, in a fresh context (an empty cache, like a first visit). It uses a **4× slower CPU and a 9 Mbit/s, 60 ms network**, roughly a mid-range phone, and takes the median of three runs. It records:

- **JS downloaded:** compressed bytes over the network, and uncompressed size;
- **LCP (Largest Contentful Paint):** when the main content appeared (good: ≤ 2.5 s);
- **CLS (Cumulative Layout Shift):** how much the page jumped around (good: ≤ 0.1);
- **TBT (Total Blocking Time):** main-thread time stuck in long tasks, the lab stand-in for how sluggish taps feel (good: ≤ 200 ms).

### 13.1 Layout shift: charts that measured too late

The dashboard scored **0.106**, just over the limit. Layout-shift entries name the elements that moved: the whole **Trends** section jumped up 223 px, then down 240 px. Our charts measure their own width (Stage 8) and rendered **nothing** until they had, so each chart box was 0 px tall for a frame, everything below collapsed, and then everything jumped back. The fix: charts reserve their height from the first render, and loading skeletons use each chart's real height (they had been 8–16 px off). Result: **0.106 → 0.002**.

### 13.2 Content hidden until JavaScript ran

The `Page` wrapper faded in with a Motion animation: `initial={{ opacity: 0 }}`. The server sends fully rendered HTML, but it sat **invisible** until the JavaScript loaded, hydrated and started the animation, which took about 1.5–2 s on the throttled phone. The fix was a **CSS** animation (`animate-page-in`), which starts as soon as the HTML arrives. Every app page now reports LCP at about **430–470 ms**, with no later candidate appearing once the content fades in. Before, the Household page's content only became a paint candidate at 1,744 ms, when the JavaScript animation finally revealed it.

### 13.3 Code that isn't needed yet

The ⌘K palette and its search library loaded on every page, though most visits never open it. It's now loaded with `next/dynamic` the first time it's opened. The ⌘K shortcut moved into the app shell, because a palette that isn't loaded can't listen for its own shortcut.

### 13.4 An experiment we reverted

Motion's animation engine is about 200 KB of JavaScript on every page. Its documented remedy, `LazyMotion` (light `m.*` components, with the engine loaded after first paint), needed changes in 39 files. We measured it:

- total JavaScript was unchanged, because the engine still downloads during the visit;
- blocking time summed to 4,655 ms across pages, against 4,673 ms before, which is no difference.

**We reverted it.** A change that isn't measurably better is a cost (complexity, risk) with no benefit.

### 13.5 Budgets

The script ends by checking budgets: **JS ≤ 400 KB compressed, LCP ≤ 2.5 s, CLS ≤ 0.1** per page. The limits sit a little above today's numbers, which leaves room for honest growth and none for accidents.

Blocking time is **not** budgeted yet. It's 650–930 ms on the throttled CPU, and a budget that's always red gets ignored. It comes from about 300 KB of compressed framework and library JavaScript shared by every page, plus hydrating a client-rendered app. The likely levers, each to be **measured**:

- rendering more of the static parts as React Server Components;
- `zod/mini` for the browser bundle;
- splitting the dashboard's drag-and-drop code until a widget is actually grabbed.

---

## 14. Results

### API, heavy households (p99)

| Endpoint             | Baseline | Fixes, cache **off**              | Fixes, cache **on** |
| -------------------- | -------- | --------------------------------- | ------------------- |
| Net worth, 12 months | 4,989 ms | 279 ms                            | 9 ms                |
| Goals                | 1,498 ms | 32 ms                             | 9 ms                |
| Recurring bills      | 2,241 ms | 2,668 ms (noise; still CPU-bound) | 9 ms                |
| Budgets              | 171 ms   | 233 ms (noise, §12)               | 9 ms                |
| Spending by category | 119 ms   | 146 ms (noise)                    | 12 ms               |
| Accounts             | 99 ms    | 111 ms (noise)                    | 11 ms               |

### API, typical households (requests per second)

| Endpoint  | Baseline | Cache off | Cache on |
| --------- | -------- | --------- | -------- |
| Net worth | 9        | 1,044     | 2,791    |
| Goals     | 18       | 1,158     | 2,894    |
| Cash flow | 973      | 1,389     | 3,115    |
| Budgets   | 495      | 531       | 2,852    |

How to read the cache-on numbers: requests rotate round-robin through the households and nothing writes during the test, so after the first pass almost every request is a cache hit. That's the **best case**. In real use, a write invalidates one household's entries, so the hit rate depends on how many reads happen between writes. For a household dashboard (read on every visit, written a few times a day) that's typically most reads, but it's an assumption to verify with production metrics (Stage 14).

### Browser (median of 3, throttled)

| Page      | JS (compressed) | LCP before → after | CLS before → after | TBT before → after |
| --------- | --------------- | ------------------ | ------------------ | ------------------ |
| Dashboard | 367 → 364 KB    | 1,984 → **432 ms** | 0.106 → **0.002**  | 858 → 690 ms       |
| Budgets   | 353 → 354 KB    | 2,108 → **436 ms** | 0 → 0              | 871 → 820 ms       |
| Household | 345 → 342 KB    | 1,760 → **468 ms** | 0 → 0              | 908 → 651 ms       |

(TBT differences of ±15% are within this machine's noise; LCP and CLS changes are explained in §13.)

---

## 15. Capacity: how many households per server?

A **back-of-the-envelope estimate**. It isn't a guarantee; its value is that every assumption is written down, so you know what to measure when real traffic arrives.

**Measured** (one API process = one CPU core, on a 4-core VM shared with Postgres and the load generator):

- cached reads: about 2,800 requests/s;
- uncached reads for typical households: about 1,000 requests/s;
- the API process: 252 MB of memory with a warm cache;
- storage: 322 bytes per transaction, including indexes.

**Assumed:**

| Assumption                                 | Value                     |
| ------------------------------------------ | ------------------------- |
| API requests per page view                 | 10                        |
| Cache hit rate                             | 80%                       |
| Target CPU utilisation                     | 50% (headroom for spikes) |
| Page views per household per day           | 30 (2 members × 15)       |
| Share of daily traffic in the busiest hour | 15%                       |

**Arithmetic:**

- blended cost per request = 0.8 × (1/2,800 s) + 0.2 × (1/1,000 s) ≈ **0.49 ms of CPU**
- at 50% utilisation that's ≈ 1,000 requests/s ≈ **100 page views/s per API process**
- one household at peak = 30 × 15% ÷ 3,600 s ≈ **0.00125 page views/s**
- **≈ 80,000 households per API process, at peak**

**What would break first, in order:**

1. **Heavy households on a cache miss.** One heavy household's recurring-bills miss costs about 70 ms of single-threaded CPU. A few of those at once delay everyone on that process. Fix: precompute in a background job.
2. **Postgres connections.** About 8 API processes at pool size 10 use up the default 100 connections. Fix: PgBouncer.
3. **Postgres CPU on uncached aggregations,** as data grows. Fix: monthly roll-up tables maintained by triggers, then read replicas.
4. **Storage:** 80,000 households × 1,500 transactions a year × 322 bytes ≈ **39 GB per year**. That's comfortable for one Postgres server for years. A partitioning plan becomes worthwhile around the 1 TB mark.
5. **Live connections (Stage 11).** If 5% of 80,000 households are online with two tabs, that's 8,000 SSE streams on one process: fine in principle (they're idle sockets), but memory needs watching.

The API is **stateless**: its cache keys come from the database, and live events from `LISTEN`. Scaling out means adding processes behind a load balancer, which is Stage 14.

---

## 16. What testing and looking caught

1. **Fake ids that weren't UUIDs.** `md5(…)::uuid` gives random version bits; the API's strict id validation rejected every request. That was correct, and it's a reminder that test data must obey the same rules as real data.
2. **The `__Host-` cookie.** Production cookies are named `__Host-ledgerly_session` (Stage 5). The first load test sent the development name and measured 401s.
3. **Failed requests look fast.** Both of those runs looked like excellent results. Now the load runner refuses to save any run that contains errors.
4. **autocannon's context is per request, not per connection.** A write benchmark assigned a new household on every request and ran past household 1,000 into 401s. The main runner wraps around with `%`, so its results were valid, but its description in this document had to be corrected.
5. **A trigger that broke household deletion.** Deleting a household cascades to its transactions, which fired the version trigger for a household that was already gone, violating the foreign key. An existing database test caught it. The trigger now skips households that no longer exist, and two new tests pin the behaviour down.
6. **`pnpm setup` is a built-in command.** Naming a package script `setup` ran pnpm's own setup, which edited the shell profile. We undid the change and renamed the script `dataset`. Avoid script names that pnpm already uses.
7. **The sign-in page measured while signed in.** It redirected to the dashboard, so the first "sign-in" numbers were the dashboard's. Pages that need a session and pages that need none are now measured differently.

---

## 17. Run it yourself

```bash
pnpm --filter @ledgerly/perf run dataset
```

```bash
pnpm --filter @ledgerly/api build && pnpm --filter @ledgerly/perf run api
```

In a second terminal:

```bash
pnpm --filter @ledgerly/perf run load -- --label mine
```

Then look at where database time went:

```bash
psql postgres://ledgerly:ledgerly@localhost:5432/ledgerly_perf -c "select calls, round(mean_exec_time::numeric,1) as mean_ms, left(query, 80) from pg_stat_statements order by total_exec_time desc limit 5"
```

For the browser numbers, build and start the web app against the perf API, then:

```bash
pnpm --filter @ledgerly/perf run web -- mine
```

If you use Docker, recreate the Postgres volume once (`docker compose down -v && pnpm db:up`) so the new `init.sql` creates `ledgerly_perf` and enables `pg_stat_statements`.

---

## 18. Exercises

1. **See the JIT yourself.** In `psql`, run `EXPLAIN (ANALYZE)` on the net-worth query with `SET jit = on` and then `off`. Find the `JIT:` section and its timings.
2. **Fix the estimate instead.** Rewrite the net-worth query so the planner's estimate is right: replace the `generate_series` + correlated subquery with a window function (`sum(net) OVER (ORDER BY month)`). Check the estimated cost with `EXPLAIN`.
3. **Precompute recurring bills.** Move `detectRecurring` into a background job, triggered like `budgets.evaluate` (Stage 10), that stores its result per household. The endpoint becomes a lookup. What should happen when the result is stale?
4. **Measure a realistic hit rate.** Extend the load test with a writer that adds one transaction per household every N seconds. Plot p99 against N.
5. **PgBouncer.** Run it in transaction mode in front of Postgres and repeat the pool experiment with 8 API processes. What breaks? (Hint: prepared statements and `LISTEN` need session mode, or newer PgBouncer features.)
6. **A covering index.** Try `CREATE INDEX … ON transactions (account_id) INCLUDE (amount_minor)` for account balances. Measure reads before and after, **and** write throughput. Is it worth it?
7. **Server Components.** Turn the Household page's static parts (the roles card, headings) into Server Components and measure JS and TBT.
8. **Budget TBT.** Pick a TBT budget you could actually meet, add it to `web-vitals.mjs`, and make it pass.

---

## 19. Glossary

| Term                            | Meaning                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| **p50 / p99**                   | The latency half of requests beat / 99% of requests beat. p99 is what your unluckiest users see. |
| **Throughput**                  | Requests completed per second.                                                                   |
| **Little's law**                | In-flight requests = throughput × latency.                                                       |
| **Load test**                   | Sending many concurrent requests to measure throughput and latency under pressure.               |
| **pg_stat_statements**          | Postgres extension recording calls and time per query shape.                                     |
| **EXPLAIN ANALYZE**             | Runs a query and shows its plan with real timings and row counts.                                |
| **JIT (Postgres)**              | Compiling a query to machine code when it's estimated to be expensive.                           |
| **CTE inlining / MATERIALIZED** | Postgres may merge a `WITH` query into where it's used; `MATERIALIZED` forces it to run once.    |
| **Event loop blocking**         | CPU work in Node that stops every other request on the process from making progress.             |
| **Prepared statement**          | A query built and planned once, then executed many times with different values.                  |
| **Cache invalidation**          | Deciding when cached data is stale. Version-keyed caches avoid doing it explicitly.              |
| **ETag / 304**                  | A fingerprint of a response; if the client's copy matches, the server answers "Not Modified".    |
| **Connection pool**             | A set of reusable database connections; its size caps how much work runs concurrently.           |
| **A/B (side by side)**          | Comparing two versions under identical conditions, interleaved, to separate change from noise.   |
| **LCP / CLS / TBT**             | Core Web Vitals: when content appears, how much it jumps, how long the main thread is blocked.   |
| **Performance budget**          | A limit (bytes, ms) that fails a check when exceeded.                                            |
| **Capacity estimate**           | Measured costs plus written-down assumptions, giving a capacity number and the first bottleneck. |

---

## 20. What's next

**Stage 13: Testing strategy.** We have 362 automated tests and a habit of browser-checking every stage by hand-written scripts. Next we make that a **strategy**: what to test at which level (unit, integration, end-to-end) and why, a committed Playwright suite that runs in CI against the real stack, test data that stays deterministic, coverage that means something, contract tests between web and API, and handling flaky tests. The load and Web Vitals checks from this stage become part of it too.
