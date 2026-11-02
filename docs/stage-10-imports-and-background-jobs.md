# Stage 10 — Imports & Background Jobs

> **Goal of this stage:** until now, every piece of work happened _while a request waited_. This stage adds work that happens **in the background**: importing a bank file with thousands of rows, creating your rent payment on the 1st of every month, and alerting every member of the household when a budget goes over, even if nobody has the app open.
>
> **What you'll learn:** what a job queue is and how to build a correct one on PostgreSQL (`SKIP LOCKED`, leases, retries with backoff, `LISTEN/NOTIFY`). You'll also learn why background work is delivered **at least once**, which means every job must be **idempotent**, plus how to parse messy real-world files and how to schedule work without a "leader" process.

![Importing 16,615 rows: the mapping step with a live preview](./images/stage-10-mapping.png)

---

## Table of contents

1. [What we built](#1-what-we-built)
2. [Why background jobs?](#2-why-background-jobs)
3. [Choosing a queue](#3-choosing-a-queue)
4. [Inside the queue](#4-inside-the-queue)
5. [A database trigger that queues work](#5-a-database-trigger-that-queues-work)
6. [CSV import, end to end](#6-csv-import-end-to-end)
7. [Recurring rules: from detection to automation](#7-recurring-rules-from-detection-to-automation)
8. [Notifications and email](#8-notifications-and-email)
9. [The interface](#9-the-interface)
10. [What testing and looking caught](#10-what-testing-and-looking-caught)
11. [Testing](#11-testing)
12. [Run it yourself](#12-run-it-yourself)
13. [Exercises](#13-exercises)
14. [Glossary](#14-glossary)
15. [What's next](#15-whats-next)

---

## 1. What we built

| Area     | What's new                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database | `jobs` and `job_schedules` (the queue), `imports`, `recurring_rules`, `notifications`; import and rule columns on `transactions` with **unique indexes that make duplicates impossible**; `households.time_zone`; a trigger that queues budget checks. |
| Worker   | A **separate process** (`apps/api/src/worker.ts`) that runs jobs: CSV imports, budget evaluation, recurring rules, emails and daily housekeeping. `pnpm dev` now starts it next to the API.                                                            |
| Shared   | CSV logic (date and amount parsing, guessing which column is which, applying a mapping), `nextRecurringDate`, `todayIn(timeZone)`.                                                                                                                     |
| API      | `/imports` (upload, start, progress, undo), `/recurring-rules`, `/notifications`.                                                                                                                                                                      |
| Web      | An **Imports** page (drop a file, match the columns, watch progress, undo), an **Automate** button on Upcoming bills, an **Automatic transactions** card, and a **notification bell**.                                                                 |

The life of an import, across three processes:

```
 Browser                      API (Fastify)                          Worker
 ───────                      ─────────────                          ──────
 drop file ──POST text/csv──► store file, parse, guess mapping
          ◄── 201 preview ──
 confirm  ──POST /start ────► BEGIN
                                update import → "queued"
                                insert job "import.process"
                                NOTIFY ledgerly_jobs           ┌──► wakes up (LISTEN)
                              COMMIT ────────────────────────────┘    claim job (SKIP LOCKED)
          ◄── 202 Accepted ──                                         parse → map → insert in
 poll GET /imports/:id  ─────► processed 4,502 / 16,617 ◄───────────  chunks of 500, update progress
 ...                                                                  "completed" + notification
 bell / toast ◄─────────────── GET /notifications ◄──────────────────  (+ email job)
```

---

## 2. Why background jobs?

A web request should answer in **milliseconds**. Some work takes seconds or minutes, or needs to happen when nobody is asking:

| Work                                       | Why it can't happen inside a request                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Import 16,615 rows                         | Takes seconds; browsers, proxies and load balancers time out; a dropped connection would lose the work halfway. |
| Record rent on the 1st                     | Nobody is sending a request at midnight.                                                                        |
| Email every member when a budget goes over | Email providers can be slow or down for a minute. Your partner's alert shouldn't fail because of that.          |
| Delete old sessions every day              | Housekeeping belongs to nobody's request.                                                                       |

Moving that work into **jobs** run by a separate **worker process** gives you:

1. **Fast responses.** The API records "please do X" and answers at once, with **`202 Accepted`** ("we've got it and it will happen", which is different from "it's done").
2. **Failure isolation.** If the email provider is down, emails wait and retry; nothing the user did fails.
3. **Retries.** A job that fails because of a network blip runs again later, automatically.
4. **Independent scaling.** Lots of imports? Add workers. Lots of visitors? Add API instances. Each process type scales on its own.

The worker is built from **the same code** as the API. It imports the same services, uses the same database package and the same pure functions, but runs a different entry point (`src/worker.ts` instead of `src/server.ts`). Rails with Sidekiq, Django with Celery and Laravel with Horizon all use this same setup.

---

## 3. Choosing a queue

| Option                               | Good at                                                                                        | Costs                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **PostgreSQL table** (what we built) | Enqueue **in the same transaction** as your data; nothing new to run; easy to inspect with SQL | Thousands of jobs per second is its comfortable limit; polling and locks add database load |
| Redis + BullMQ / Sidekiq             | Very high throughput, rich features (rate limits, priorities, dashboards)                      | Another system to run, back up and monitor; enqueue is **not** atomic with your database   |
| Managed (SQS, Cloud Tasks, Pub/Sub)  | No servers, near-infinite scale                                                                | Same atomicity gap; vendor lock-in; harder to run locally                                  |

We chose Postgres, and the deciding reason is the first cell of the first row. Look at what starting an import does:

```ts
// apps/api/src/modules/imports/imports.service.ts
return db.transaction(async (tx) => {
  // …lock the import row, validate the mapping…
  await tx.update(imports).set({ status: "queued", mapping }).where(eq(imports.id, importId));
  await enqueue(tx, "import.process", { importId }, { singletonKey: `import:${importId}` });
});
```

Both writes commit together or not at all. With Redis, you'd write to Postgres and then push to Redis. If the process dies between the two, you have an import stuck in "queued" forever, with no job to run it. Fixing that requires the **transactional outbox pattern**, where you write the job into a database table and relay it to Redis afterwards. With a Postgres queue, the outbox _is_ the queue.

When would we switch? When jobs reach thousands per second, or when many services need to consume the same events. That's a scale problem to measure first (Stage 12), not to guess at now.

> **Best practice:** use the simplest infrastructure that's correct for your scale. "Boring technology" you already run (Postgres) beats a new moving part, until you've measured that it doesn't.

---

## 4. Inside the queue

All of this is about 300 lines in `apps/api/src/jobs/`. Libraries like **pg-boss** and **Graphile Worker** do the same, with more features. We built it ourselves because every line teaches something, and because it keeps working in this sandboxed environment.

### 4.1 The `jobs` table

```
id · name · payload (jsonb) · status (queued | running | succeeded | failed)
run_at          not before this moment (delays, retries, debouncing)
attempts        how many times it has been started
max_attempts    null = the job type's default
locked_by / locked_until   the LEASE of the worker running it
last_error · singleton_key · finished_at
```

Partial indexes match the questions workers ask, so each index only contains the rows that question needs:

```sql
CREATE INDEX jobs_ready_idx         ON jobs (run_at)       WHERE status = 'queued';
CREATE INDEX jobs_running_lease_idx ON jobs (locked_until) WHERE status = 'running';
```

### 4.2 Claiming jobs: `FOR UPDATE SKIP LOCKED`

The core of any database queue is one query:

```sql
update jobs set status = 'running', attempts = attempts + 1,
                locked_by = $worker, locked_until = now() + interval '60 seconds'
where id in (
  select id from jobs
  where (status = 'queued' and run_at <= now())
     or (status = 'running' and locked_until < now())   -- lease expired: its worker died
  order by run_at
  limit $n
  for update skip locked
)
returning id;
```

`FOR UPDATE` locks the selected rows. **`SKIP LOCKED`** says: if another transaction already locked a row, don't wait for it, just skip it and take the next one. Without it, three workers would queue up behind the same first row (lock contention). Without the lock at all, two workers could take the same job.

A test proves it. It queues 30 jobs, starts **three workers at once**, and checks that every job ran **exactly once** and that the work was actually shared.

### 4.3 Leases and heartbeats: surviving crashes

A claimed job gets a **lease** (`locked_until`). While the handler runs, the worker renews the lease every third of its length; that's the **heartbeat**. If the worker process dies, the heartbeats stop, the lease runs out, and any worker's next claim query picks the job up again (the second half of the `WHERE` above).

We tested this for real, with the full stack running:

```
progress before crash: processing 4,502 rows
💥 worker killed with SIGKILL (no chance to clean up)
job: running | attempts 1 | lease valid for another 1:54
… worker restarted; it waits for the lease …
07:01:12 completed | 16,617 processed | 16,615 imported | 0 duplicates
job: succeeded | attempts 2
check: 16,615 rows, 16,615 distinct fingerprints
```

The lease length is a trade-off: **short** leases recover crashes quickly but risk taking over a job that's merely slow; **long** leases are safe but slow to recover. Heartbeats let us have both. The import job uses a 2-minute lease and renews it every 40 s, so a live import is never taken over, and a dead one recovers within 2 minutes.

### 4.4 At-least-once delivery, so every handler is idempotent

Look closely at that crash. Worker #1 had already inserted thousands of rows when it died. Worker #2 ran the **same job again from the start**. Yet there are no duplicates. Why?

Because no queue can promise "exactly once". A worker can always crash after doing the work but **before** recording that it did. Every real queue (SQS, Sidekiq, BullMQ, ours) gives you **at-least-once** delivery. Exactly-once _effects_ are the handler's job, and in Ledgerly every handler is **idempotent** (safe to run twice):

| Job                 | What makes a second run harmless                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `import.process`    | A unique index on `(account_id, import_fingerprint)` + `ON CONFLICT DO NOTHING`; counts are read from the database at the end. |
| `recurring.run-due` | A unique index on `(recurring_rule_id, occurred_on)`: one transaction per rule per date, ever.                                 |
| `budgets.evaluate`  | A unique index on `(user_id, dedupe_key)` for notifications, e.g. `budget:<id>:2026-11:over`.                                  |
| `email.send`        | The notification id is passed as the provider's **idempotency key** (see §8).                                                  |

Notice that each guarantee is enforced **by the database**, not by careful code. Careful code has bugs; a unique index doesn't.

> **Best practice:** design every background job to be idempotent, and back that with database constraints. It's the single most important rule of asynchronous systems.

### 4.5 Retries: exponential backoff with jitter

When a handler throws, the job goes back to `queued` with a later `run_at`:

```ts
export function backoffMs(attempt: number, random = Math.random) {
  const base = Math.min(10_000 * 2 ** (attempt - 1), 3_600_000); // 10 s, 20 s, 40 s … ≤ 1 h
  return Math.round(base * (0.5 + random())); // ±50% jitter
}
```

- **Exponential:** if a dependency is down, hammering it every second makes things worse. Waiting longer each time gives it room to recover.
- **Jitter:** if 500 jobs failed at the same moment, retrying them all at exactly +10 s would cause a synchronised stampede (the "thundering herd"). Random spread smooths it out.
- **A limit:** after `maxAttempts` (5 by default, 3 for imports, 8 for emails) the job becomes `failed` and is **kept** for 30 days, with its `last_error`, for investigation. Some queues call these "dead letters".
- **Permanent errors** skip the retries. A handler throws `PermanentJobError` for problems time can't fix (an invalid payload, deleted data). Retrying them would only waste work.

### 4.6 Waking up instantly: `LISTEN` / `NOTIFY`

Polling every second wastes queries and adds up to a second of delay. Postgres has a built-in publish/subscribe channel:

```ts
await db.execute(sql`select pg_notify('ledgerly_jobs', ${name})`); // inside enqueue()
```

The worker keeps one dedicated connection doing `LISTEN ledgerly_jobs` and wakes up the moment a notification arrives. The important detail: **Postgres delivers notifications only when the transaction commits.** A worker can never be woken for a job it can't see yet. Polling stays as a fallback, for delayed jobs, for when the listening connection drops, and for running workers without `LISTEN`.

### 4.7 Singleton keys: debouncing

```sql
CREATE UNIQUE INDEX jobs_singleton_key ON jobs (singleton_key) WHERE status = 'queued';
```

While a job with key `budgets.evaluate:<household>:2026-11` is **queued**, enqueuing another with the same key does nothing. Ten edits in two seconds therefore produce **one** evaluation. Once the job starts running, its row is no longer `queued`, so the next change queues a fresh evaluation. Changes made during a run are never missed.

### 4.8 Schedules without a leader

"Run `recurring.run-due` every 15 minutes." With three workers running, who does it? The usual answer is **leader election**: workers vote for one of them, which then has to handle failover. We avoid that entirely:

```sql
update job_schedules
set next_run_at = now() + make_interval(secs => interval_seconds), last_run_at = now()
where next_run_at <= now()
returning name;      -- then enqueue each returned schedule, in the same transaction
```

Every worker runs this every few seconds. A single `UPDATE` is atomic, so only one worker sees the row as due: the others find `next_run_at` already moved forward. A test runs it from three workers at once and expects exactly one job. This works because a row update in Postgres is an **atomic compare-and-set**.

### 4.9 Graceful shutdown

On `SIGTERM` (every deploy sends one), the worker:

1. stops claiming new jobs;
2. fires an **`AbortSignal`** that long jobs check at safe points (the import checks between chunks);
3. waits up to 25 s for running jobs to finish;
4. **hands back** any job still running after that (`status = 'queued'`, lease cleared), so another worker takes it at once instead of waiting for the lease.

A job that stops because of the signal (like an import between chunks) simply fails this attempt and is retried after the usual backoff. Its idempotency makes the retry safe.

### 4.10 One more process to configure

`src/worker.ts` loads the same environment variables as the API, plus `WORKER_CONCURRENCY` (default 4 jobs at a time). Its connection pool is sized **concurrency + 2**: one connection per running job, plus the `LISTEN` connection and the scheduler. Its statement timeout is 60 s instead of the API's 10 s, because background work is allowed to take longer than a web request.

---

## 5. A database trigger that queues work

When should Ledgerly check budgets? "After the API creates a transaction" sounds right, but transactions are now also written by **imports**, by **recurring rules**, by bulk edits, and by anyone running SQL by hand. Stage 9's lesson ("store facts, derive the rest") applies here too. If one code path forgets to queue the check, alerts silently stop.

So the **database** queues it, with a statement-level trigger (migration `0008`):

```sql
CREATE TRIGGER transactions_budget_evaluation_insert AFTER INSERT ON transactions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION enqueue_budget_evaluation();
-- (and the same for UPDATE and DELETE)
```

The function collects the distinct (household, month) pairs from the changed rows and inserts one debounced job per pair. Only the household's **current** month is included, and "current" is computed in **the household's own time zone** (`now() AT TIME ZONE h.time_zone`):

- **`FOR EACH STATEMENT` with transition tables:** an import inserting 500 rows fires the trigger once, not 500 times.
- **It runs inside the writing transaction,** so a rolled-back change never leaves a job behind.
- **Debounced:** `run_at = now() + 2 s` plus the singleton key.
- **Old months never alert.** Importing last year's statements doesn't spam you about last year.

The proof was in the first seed after the migration: inserting 430 transactions queued exactly **one** job. Tests cover debouncing, rollback, the current-month filter, and "a new job once the previous one is running".

**The trade-off:** triggers are **invisible** when you read the application code. A new developer won't see "creating a transaction queues a job" anywhere in `transactions.service.ts`. We pay for that with a comment in the migration, this section, and tests named after the behaviour. Use triggers sparingly, for rules that must hold **no matter who writes**.

---

## 6. CSV import, end to end

### 6.1 Uploading the file

The browser sends the file as the raw request body, with `Content-Type: text/csv`:

```ts
app.addContentTypeParser("text/csv", { parseAs: "string", bodyLimit: MAX_IMPORT_BYTES }, …);
```

- **No multipart parsing** is needed for one text file.
- **CSRF stays closed.** In Stage 5 we only accepted JSON bodies, because an HTML form (the classic CSRF weapon) can only send three content types. `text/csv` isn't one of them, so a hostile page would need a CORS preflight, which it can't get. The parser is registered **inside the imports plugin only**, so no other route accepts CSV.
- **Limits:** 5 MB (`413 Payload Too Large`) and 20,000 rows (`422 too_many_rows`). These protect the server, and they're large enough for a year of a busy credit card.

The upload **stores** the file and returns a **preview** (the first 20 rows) plus a **guessed mapping**. Nothing is imported until the user confirms.

### 6.2 Guess, show, confirm

Every bank's CSV export looks different:

```
Chase:   Transaction Date,Post Date,Description,Category,Type,Amount
Monzo:   Date,Time,Type,Name,Emoji,Category,Amount,Currency,…
A UK bank: Date,Description,Paid out,Paid in,Balance
```

Rather than hard-coding banks, `guessMapping()` reads header names ("date", "payee", "debit"…) and, failing that, column **contents** (which column parses as dates, which as amounts). Then the UI **shows** what that mapping produces, and the user corrects it if needed.

The key design decision is that the mapping logic lives in `@ledgerly/shared` as pure functions. The browser runs `applyMapping()` for the live preview, and the background job runs **the same function** for the real import. What you see in the preview is exactly what gets imported.

### 6.3 Dates are ambiguous

Is `03/04/2026` the 3rd of April or the 4th of March? It depends on the country, and **the file doesn't say**. Guessing silently would put transactions in the wrong month. So `detectDateFormats()` returns **every** format that fits, and the UI asks when more than one does.

Two refinements came from testing (§10):

- **Look at every row.** `11/01/2025` fits both formats, but a `11/13/2025` further down proves the file is month-first. The server has the whole file, so it uses all of it.
- **Tolerate junk.** Real exports contain `PENDING` rows and `Total` footers. A format only needs to read 80% of rows, and the rows that don't parse are reported back to the user ("Row 43: Unreadable date "PENDING"").

### 6.4 Amounts

`parseImportAmount()` handles what banks actually produce: `$1,234.56`, `-12.00`, `(45.00)` (accounting-style negative), `45.00-`, `1.234,56` (European), and separate **money out / money in** columns. Some card exports show purchases as **positive** numbers, so there's a "Spending shows as positive" switch that flips every sign. As always, money never passes through a float: the parsed text goes through Stage 1's `parseMoney`.

### 6.5 Duplicates: fingerprints with occurrence numbers

Banks don't give rows stable ids, and people re-download overlapping date ranges all the time. So each row gets a **fingerprint**:

```
sha256(account | date | amount | normalised description | occurrence)
```

with a unique index per account. Re-importing a row is a silent no-op (`ON CONFLICT DO NOTHING`). The **occurrence number** matters: two identical $4.50 coffees on the same day are two real purchases, so the second one gets occurrence 2 and a different fingerprint. In the browser test, importing an export that overlapped the previous one by 300 rows reported **"Imported 3 · Already imported 300"**.

![An overlapping export: 3 new rows, 300 recognised as already imported](./images/stage-10-duplicates.png)

A known gap, kept honest: fingerprints only recognise **previous imports**. A coffee you typed in by hand and then imported from your bank appears twice. Matching those ("probably the same transaction") is fuzzy work (same amount, a few days apart, similar name), and it's left as an exercise.

### 6.6 Learning categories from history

Before inserting, the job builds a map from your last year of transactions: _normalised payee + direction → the category you used most_. So "Trader Joe's #552" (normalised to "trader joe's") lands in **Groceries**, because that's where you put Trader Joe's before. Payees it has never seen, like "Tartine Bakery", stay **uncategorised**. A wrong guess costs you more than no guess at all, because you'd have to notice it and fix it.

### 6.7 Chunks, progress and counting from the truth

Rows are mapped in memory (fast and pure), then inserted in **chunks of 500**. Each chunk is its own short transaction that also updates `processed_rows`, which is what the progress bar shows. Long transactions hold locks and bloat the database; short ones keep everything else responsive.

At the end, `imported_count` is computed with `SELECT count(*) … WHERE import_id = $1`, **not** from a counter in memory. A counter would be wrong after a crash and a retry; the database count can't be.

### 6.8 Undo, and data minimisation

**Undo** deletes the import's transactions (`WHERE import_id = $1`, using the index) and marks it `reverted`. The 16,615-row undo took **107 ms**.

**Data minimisation:** the raw file contains a bank statement, which is sensitive. Once the import finishes, `file_text` is set to `NULL`. Data you no longer hold can't leak. In production, files would go to object storage (S3) with a lifecycle rule that expires them; Stage 14 covers that.

![Import complete, with a toast from the notification the job created](./images/stage-10-complete.png)

---

## 7. Recurring rules: from detection to automation

Stage 9 _detected_ recurring bills. Now one click on **⚡ Automate** turns a detected series into a **rule**, and the worker records it on its own when it's due.

![Rent automated from Upcoming bills; the rule appears under Automatic transactions](./images/stage-10-automation.png)

### 7.1 One function for "next date"

Detection _predicts_ the next date and the scheduler _creates_ it, so both must use the same calculation. `nextRecurringDate()` in shared handles weekly rules, monthly rules on a day (with the 31st clamped to Feb 28 and back to Mar 31), and **twice-monthly** rules on two real days (the 1st and the 15th, not "every 15 days").

That last case was a bug in Stage 9's detection, found while writing this stage. A salary paid on the 1st and the 15th was predicted for the 16th.

### 7.2 Whose "today"?

In Stage 9 the browser sent "today", because the user's calendar is the one that matters. A background job has no browser to ask. So households now store a **time zone** (`America/Los_Angeles`). New sign-ups send the browser's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), and jobs compute "today" with it:

```ts
todayIn("America/Los_Angeles", new Date("2026-11-01T06:30:00Z")); // "2026-10-31"
todayIn("UTC", new Date("2026-11-01T06:30:00Z")); // "2026-11-01"
```

Without this, a Californian's rent would be recorded at 4 pm on the last day of the month (midnight UTC).

### 7.3 Catch-up, idempotence and locking

`recurring.run-due` runs every 15 minutes, and immediately after a rule is created. For each due rule, inside one transaction:

1. **Lock the rule row** with `FOR UPDATE SKIP LOCKED` (two workers never process the same rule);
2. **Catch up:** create a transaction for _every_ missed date up to today, each with its **own** date. If the worker was down for three weeks, a weekly rule creates three transactions dated three, two and one week ago (a test does exactly this);
3. insert with `ON CONFLICT (recurring_rule_id, occurred_on) DO NOTHING`;
4. advance `next_date`.

If the worker crashes between steps 3 and 4, the retry repeats step 3, and the unique index absorbs it.

**Rules fail safe.** If the rule's account gets archived, the rule **pauses itself** and sends a notification saying why, instead of failing every 15 minutes forever.

Deleting a rule keeps the transactions it already created (`ON DELETE SET NULL` on their rule link). The past stays as it was.

---

## 8. Notifications and email

### 8.1 The server decides, exactly once

Stage 9's alerts were computed **in the browser**. That meant only the person who made the change saw them, only in that tab, and only while the app was open. Now:

1. A change to this month's transactions → **the trigger** queues `budgets.evaluate` (§5).
2. The job recomputes the month with the **same pure `computeBudgetMonth`** as the Budgets page.
3. For each budget at _warning_ or _over_, it notifies **every member** with `dedupeKey = budget:<id>:<month>:<level>`.
4. A unique index on `(user_id, dedupe_key)` means each person is told about each level **once per month**, however many times the job runs.
5. Each new notification queues an `email.send` job.

![The bell: budget alerts and finished imports, newest first](./images/stage-10-bell.png)

In the browser test, recording a $400 concert ticket produced **"Entertainment is over budget"** as a toast **4.8 seconds** later: 2 s debounce, then the worker, then the web app's notification refresh. Stage 11 will bring that down to near-instant.

### 8.2 Email behind an interface

```ts
export interface Mailer {
  send(email: Email, options?: { idempotencyKey?: string }): Promise<void>;
}
```

The code that decides _what_ to send never knows _how_ it's sent. Production would plug in a provider (Postmark, SES, Resend). Development uses `LogMailer`, which prints the email in the worker's log, and the tests use `MemoryMailer` and assert on what was "sent":

```
📧 Email (development: not really sent)
Hi Alex,
$400.00 of $90.00 spent in November.
Open Ledgerly: http://localhost:3000/app/…/budgets
```

Email is a side effect **you can't take back**. If the worker crashes right after the provider accepted the message, the retry sends it again. We pass the notification id as an **idempotency key**, which providers that support one use to drop the duplicate. For the ones that don't, a rare duplicate email is the accepted cost of never _losing_ one.

### 8.3 Getting notifications to the browser

The bell polls `GET /v1/notifications` every 15 s. TanStack Query pauses that while the tab is in the background, which saves battery and server load. Two "nudges" make it feel faster: four seconds after you change a transaction, and the moment an import finishes. New unread notifications appear as a toast with a **View** action. As in Stage 9, the first load only records a baseline, because old news isn't a toast.

### 8.4 Housekeeping

`maintenance.cleanup` runs daily. It deletes succeeded jobs after 7 days, failed ones after 30, idempotency keys after 24 hours (promised back in Stage 4), expired sessions, and read notifications after 90 days. Tables that only grow eventually slow down every query that touches them.

---

## 9. The interface

### 9.1 The import flow

A three-step indicator ("Upload → Match columns → Import") tells you where you are. Steps slide horizontally (`AnimatePresence` with `mode="wait"`): forward feels like progress.

- **Dropzone.** Underneath it's a real `<input type="file">` inside a `<label>`. Keyboard and screen-reader users get the native file picker, and drag-and-drop is an enhancement on top. One subtle detail: `dragenter` and `dragleave` fire for **every child element**, so the component counts them and only clears the highlight when the count returns to zero. Without this, the highlight flickers whenever the pointer crosses the icon.
- **Match columns.** Selects for each field, with live examples in the date-format options ("Month/day/year (US) · Nov 1, 2025"). There's a warning when dates are genuinely ambiguous, and a preview table that **recomputes on every change** (rows that will be skipped are shown with their reason). The button says exactly what will happen: _"Import 16,617 rows"_.
- **Progress.** While the job is `queued`, the bar is **indeterminate** (a sliding segment). We don't know how long the wait is, so we don't pretend. While `processing` it's determinate, with "7,502 of 16,617 rows", following the 700 ms polls on a spring.
- **Results.** Three counts (imported / already imported / couldn't read), the skipped rows on demand, **Undo import** (two-step), and **View transactions**.

![Step 1: choose the account, then drop a file](./images/stage-10-upload.png)

![Progress, polled from the job](./images/stage-10-progress.png)

### 9.2 Polling, honestly

`useImport` sets `refetchInterval` to 700 ms **only while the import is running**, then stops. Polling is simple and works through every proxy and firewall, and for one progress bar it's perfectly adequate. Stage 11 adds a push channel, and this is one of the first places it will replace polling.

### 9.3 Small things

- **Import CSV** on the Transactions page, **Imports** in the sidebar, and ⌘K → "Import a bank file".
- The **bell** has a spring-in unread badge and icons per kind (status colours with icons, as always), and it lives in the sidebar on desktop and the top bar on mobile.
- Viewers see everything but can't import, automate or undo. The API enforces this (403); the UI simply doesn't offer it.

![The mapping step in dark mode](./images/stage-10-mapping-dark.png)

<img src="./images/stage-10-mobile.png" alt="Imports on a phone: the bell moves to the top bar and only the current step is named" width="320">

---

## 10. What testing and looking caught

**1. A default that hid a setting.** The first `jobs` table had `max_attempts DEFAULT 5 NOT NULL`, so a job type's own limit (`maxAttempts: 2`) was never used. The column always said 5. A test ("stops after maxAttempts") failed with four retries instead of one. The fix: the column is **nullable**, meaning "use the job type's default". Because the migration hadn't been committed yet, we regenerated it rather than adding a corrective one. Once a migration has run anywhere shared, you never edit it, you add a new one.

**2. One junk row broke date detection.** The first API test file contained a `not-a-date` row. Detection required _every_ row to parse, found no format that worked, and fell back to year-first, so every date in the file would have been wrong. Real files have junk, which led to the 80% rule.

**3. Fifty rows weren't enough.** The generated 16,000-row test export started with eleven days of November dates (`11/01`…`11/11`), all of which also fit day-first. A user picking day/month would have seen a plausible preview and imported a year of transactions into the wrong months. Detection now reads every row on the server.

**4. The Undo toast that never appeared.** Undo worked (200 OK in 107 ms) but showed no toast. The chain of events: the mutation's `onSettled` **returned** the invalidation promise, so TanStack Query waited for the history to refetch. The refetch marked the import `reverted`, which unmounted the Undo button. **Callbacks passed to `mutate()` don't run after their component unmounts.** The fix has two parts: don't return the promise (`void …`), and use `await mutateAsync()` in the button.

**5. "$61.40 of −$36,609.33 spent."** Importing a year of grocery spending into a **rollover** budget created a huge negative carry. The maths was right, and Stage 9 chose honest negative carries on purpose, but the sentence meant nothing to a person. Alerts now say _"$61.40 spent in November, with $37,109.33 of earlier overspending still carried over."_ The same lesson as Stage 9's "200 months late": the edge cases of correct maths still need plain words.

**6. Smaller ones:**

- The React Compiler lint caught a component defined inside render (same lesson as Stage 7);
- the progress spring was too soft to keep up with 700 ms polls (the screenshot showed 45% text over an almost empty bar);
- on phones, the step labels wrapped and history rows squeezed file names down to one word per line.

---

## 11. Testing

| Package            | Tests | New this stage                                                                                                                                                                                                                                                                                  |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ledgerly/shared` | 70    | 34: date/amount parsing, format detection (ambiguity, junk, all rows), mapping guesses, `applyMapping`, `nextRecurringDate`, `todayIn`                                                                                                                                                          |
| `@ledgerly/db`     | 26    | 7: trigger debouncing, rollback, current-month filter, new job after running; fingerprint and occurrence uniqueness; rule CHECK                                                                                                                                                                 |
| `@ledgerly/api`    | 145   | 33: **queue** (retries, permanent errors, singleton, transactional enqueue, SKIP LOCKED with 3 workers, lease takeover, one tick per schedule, backoff); **imports** (preview, 202, counts, learning, overlap, retry-safe, notify, undo, 409/413/415/422/403); **recurring**; **notifications** |
| `@ledgerly/web`    | 77    | (the import flow is covered end to end below)                                                                                                                                                                                                                                                   |

The API tests run jobs with a test helper that **drains the queue synchronously**, using the real job definitions and a `MemoryMailer`. Tests then read like a story: _make a change → run the jobs → check what happened_:

```ts
expect((await spend(50_000)).statusCode).toBe(201);
const runner = jobRunner(ctx.db);
await runner.run();
expect(runner.mailer.sent.map((m) => m.to).sort()).toEqual([OWNER, VIEWER].sort());
```

The browser run (API, worker and web all live):

```
1 16,617-row export: format detected as Month/day/year (US)
2 progress 0 → 12 → 39 → 72 % · 3.5 s · "Imported 16,615 transactions" toast · 2 junk rows listed
3 overlapping export: Imported 3 · Already imported 300
4 "Trader Joe's #552" → Food › Groceries (learned) · "Tartine Bakery" → Uncategorised
5 Undo: Removed 16,615 imported transactions
6 Automate Rent → rule "Monthly on the 1st · next Dec 1"
7 $400 concert → server alert toast after 4.8 s; bell lists it; dev email in the worker log
8 dark mode; mobile 390 px: no overflow; console errors: none
```

Plus the crash test in §4.3, and the usual gates: `pnpm check`, the production build and the migration drift check.

---

## 12. Run it yourself

Apply the new migrations and reseed:

```bash
pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

`pnpm dev` now starts **three** processes. Watch the worker's log in the terminal: you'll see it start, run the cleanup and recurring schedules, and print development emails.

Try:

- **Imports**: download a CSV from your real bank (or make one in a spreadsheet) and import it into Cash. Change the date format and watch the preview.
- Import the **same file again**: everything is "already imported".
- **Budgets → Upcoming bills → ⚡** on Netflix, then pause it under _Automatic transactions_.
- Record a big expense in Entertainment and wait a few seconds for the toast. Then open the bell.
- **Stop the worker** (Ctrl+C in its terminal) during a large import, then start it again with `pnpm --filter @ledgerly/api dev:worker`. The import stops at its next chunk (the `AbortSignal`), is retried about 10 seconds later, and finishes without duplicates.
- Inspect the queue directly:

```bash
psql postgres://ledgerly:ledgerly@localhost:5432/ledgerly -c "select name, status, attempts, run_at, last_error from jobs order by created_at desc limit 10"
```

---

## 13. Exercises

1. **Watch SKIP LOCKED.** Open two `psql` sessions. In both, run `begin; select id from jobs where status = 'queued' for update skip locked limit 1;`. Compare the ids. Then remove `skip locked` and try again. What happens to the second session?
2. **Manual duplicates.** Add "possible duplicate" detection: an imported row with the same account and amount as a hand-entered transaction within ±3 days. Should it be skipped, flagged, or merged? Design the UI before the code.
3. **A dead-letter screen.** Build an admin-only page listing `failed` jobs, with their `last_error` and a **Retry** button (status back to `queued`, `attempts` reset). Who should be allowed to see it?
4. **Rate limits.** An email provider allows 10 emails per second. How would you make the worker respect that across several worker processes? (Hint: a token bucket in Postgres or Redis, or a dedicated queue with concurrency 1.)
5. **Lease tuning.** Set the import lease to 5 seconds and the heartbeat interval to 10. Import a big file. What goes wrong, and why does the unique index save you anyway?
6. **Time-zone bug hunt.** Change `todayIn(household.timeZone)` to `new Date().toISOString().slice(0, 10)` in the recurring job. Write a test that fails because of it.
7. **Rules with end dates.** Add "until" (a loan's last payment) and "every N months" (quarterly bills). Which parts change: schema, `nextRecurringDate`, UI?
8. **Measure the trigger.** Insert 10,000 transactions with and without the budget trigger (`ALTER TABLE … DISABLE TRIGGER`). What does a statement-level trigger cost?

---

## 14. Glossary

| Term                        | Meaning                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| **Background job**          | A unit of work recorded now and run later by a worker process, outside any web request.           |
| **Worker**                  | A process that claims and runs jobs.                                                              |
| **202 Accepted**            | HTTP status meaning "received and will be processed", not "done".                                 |
| **SKIP LOCKED**             | Postgres option: skip rows locked by other transactions instead of waiting for them.              |
| **Lease / heartbeat**       | A time-limited claim on a job, renewed while the worker is alive; an expired lease frees the job. |
| **At-least-once delivery**  | Every job runs one or more times; duplicates are possible, losses aren't.                         |
| **Idempotent**              | Running it twice has the same effect as running it once.                                          |
| **Exponential backoff**     | Waiting twice as long after each failure before retrying.                                         |
| **Jitter**                  | Random variation added to retry delays so retries don't all happen at once.                       |
| **Dead letter**             | A job that failed permanently and is kept for investigation.                                      |
| **Transactional outbox**    | Writing "messages to send" in the same database transaction as the data, so they can't be lost.   |
| **LISTEN / NOTIFY**         | Postgres's built-in publish/subscribe; notifications are delivered on commit.                     |
| **Debouncing**              | Collapsing a burst of triggers into one action after things settle.                               |
| **Statement-level trigger** | A trigger that fires once per SQL statement (with all changed rows), not once per row.            |
| **Fingerprint**             | A hash derived from a row's contents, used to recognise it again.                                 |
| **Data minimisation**       | Keeping only the data you need, for only as long as you need it.                                  |
| **Graceful shutdown**       | Finishing or handing back in-flight work before a process exits.                                  |

---

## 15. What's next

**Stage 11: Households & real-time.** Ledgerly already has households with roles. Next we make them _shared_: inviting someone by email (a background job, of course), accepting or declining, and changing or removing members. Then we replace polling with **server push**. Notifications, import progress and your partner's new transactions will appear instantly, through **Server-Sent Events** fed by the same `LISTEN/NOTIFY` you met in this stage. You'll learn how a push connection is authenticated, how it survives reconnects, and how it scales across several API instances.
