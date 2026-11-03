# Stage 13 — Testing Strategy

> **Goal of this stage:** turn a pile of tests into a **strategy**: know what each kind of test is for, fill the gaps, make the suite fast and trustworthy, and have CI enforce it.
>
> **What you'll learn:** the levels of testing and what each one catches; how to make database tests run in parallel; what code coverage does and doesn't tell you; **property-based testing**, which found a money bug in the first second it ran; a committed **Playwright** suite that drives a real browser against the real stack; automated **accessibility** checks; an **API contract snapshot**; and how to hunt **flaky tests** instead of retrying them until they pass.

---

## Table of contents

1. [What we built](#1-what-we-built)
2. [Why a strategy, not just tests](#2-why-a-strategy-not-just-tests)
3. [The inventory: where we started](#3-the-inventory-where-we-started)
4. [Faster feedback: a database per test worker](#4-faster-feedback-a-database-per-test-worker)
5. [Coverage that means something](#5-coverage-that-means-something)
6. [Property-based testing](#6-property-based-testing)
7. [Testing the worker as it really runs](#7-testing-the-worker-as-it-really-runs)
8. [Time zones: run the tests somewhere else](#8-time-zones-run-the-tests-somewhere-else)
9. [End-to-end tests with Playwright](#9-end-to-end-tests-with-playwright)
10. [Accessibility checks](#10-accessibility-checks)
11. [The API contract snapshot](#11-the-api-contract-snapshot)
12. [Flaky tests](#12-flaky-tests)
13. [Continuous integration](#13-continuous-integration)
14. [Results](#14-results)
15. [What testing caught this stage](#15-what-testing-caught-this-stage)
16. [Run it yourself](#16-run-it-yourself)
17. [Exercises](#17-exercises)
18. [Glossary](#18-glossary)
19. [What's next](#19-whats-next)

---

## 1. What we built

| Area          | What's new                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API tests     | Test files run **in parallel**, each worker on its own database cloned from a migrated template: **70 s → 25 s**. New tests for the worker's real loop: LISTEN wake-ups, concurrency limit, graceful shutdown.   |
| Coverage      | `@vitest/coverage-v8` in every package, a **ratchet** (minimum thresholds just under today's numbers) and a `pnpm test:coverage` task that CI runs.                                                              |
| `shared`      | **19 property-based tests** (fast-check): about 9,000 generated cases per run, in about a second. One found a real bug in `formatMoney`.                                                                         |
| `e2e/`        | A new workspace: **Playwright** against the built web app, built API, worker and a fresh database. 14 tests: sign-up and sign-in, transactions, budgets with live alerts, CSV import, invitations and real-time. |
| Accessibility | **axe-core** scans every page in light and dark mode against WCAG 2.1 A/AA. It found five problems; all are fixed.                                                                                               |
| API contract  | `apps/api/openapi.json`, a committed snapshot of the API's OpenAPI document. Any contract change fails a test until it's accepted, so it always shows up in review.                                              |
| Time zones    | Web and shared tests run in `America/Los_Angeles` by default, where date bugs actually show. All suites also pass at UTC+14.                                                                                     |
| CI            | Coverage is enforced; a new **end-to-end job** runs the Playwright suite and uploads the HTML report and traces.                                                                                                 |
| Bugs fixed    | A money formatting error, a race that left the account field empty, a time-zone setting that displayed the wrong zone, and five accessibility problems (§15).                                                    |

From 362 tests in four packages to **405 in five**, and every level of the stack now has tests aimed at the bugs that level can have.

---

## 2. Why a strategy, not just tests

A test is a small program that checks another program. Every test has a **cost**: time to write, time to run, time to fix when the code changes. It also has a **value**: the bugs it would catch, and the confidence it gives you to change code. A strategy decides where tests pay for themselves.

The classic picture is the **test pyramid**: many fast unit tests at the bottom, fewer integration tests in the middle, a handful of slow end-to-end tests at the top. A popular variant, the **testing trophy**, argues that integration tests give the most confidence per minute. In practice, the right mix depends on **where your bugs live**. So we sorted Ledgerly's code by the kind of bug it can have:

| Level                         | What it runs                                        | What it catches                                                            | Ledgerly                                          |
| ----------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| **Unit**                      | One function, in memory                             | Wrong logic: off-by-one, rounding, a missed case                           | `shared` (money, budgets, CSV parsing), `web/lib` |
| **Property**                  | One function, thousands of generated inputs         | The cases you didn't think of                                              | `shared` (new this stage)                         |
| **Integration (database)**    | Real SQL against real Postgres                      | Queries, constraints, triggers, migrations                                 | `db`                                              |
| **Integration (API)**         | The whole API in-process, real Postgres, no network | Auth, permissions, validation, status codes, jobs                          | `api` (the biggest suite)                         |
| **Component**                 | A React component in a simulated DOM (jsdom)        | Rendering logic, form behaviour                                            | `web` (a few)                                     |
| **Contract**                  | The API's published description                     | Accidental changes to what clients depend on                               | `api/src/contract.test.ts` (new)                  |
| **End-to-end**                | A real browser against the whole running system     | Wiring: config, proxies, cookies, real-time, the worker, the UI as a whole | `e2e/` (new)                                      |
| **Accessibility (automated)** | axe-core inside those browser tests                 | Missing labels, contrast, invalid ARIA                                     | `e2e/tests/accessibility.spec.ts` (new)           |

Two principles shaped every decision below:

1. **Test at the lowest level that can catch the bug.** Rounding belongs in a unit test (milliseconds, exact failure message). "The session cookie reaches the API through the Next.js proxy" can only be caught end to end.
2. **A test must be able to fail.** A test that passes whatever the code does is worse than no test, because it gives false confidence. We checked this throughout with **mutation checks**: break the code on purpose and confirm the test goes red (§5).

---

## 3. The inventory: where we started

Before adding anything, we measured what we had:

| Package  | Tests | Time  | Line coverage | Notes                                                   |
| -------- | ----- | ----- | ------------- | ------------------------------------------------------- |
| `shared` | 70    | ~1 s  | 64.6%         | Domain logic well covered; schemas counted as untested  |
| `db`     | 33    | ~12 s | 81.3%         | Real Postgres                                           |
| `api`    | 179   | 70 s  | 87.4%         | Real Postgres, files run **one at a time**              |
| `web`    | 80    | ~9 s  | 12.0%         | Logic in `lib/` tested; UI checked by hand              |
| E2E      | 0     | —     | —             | Throwaway Playwright scripts, run by hand at each stage |

Four things stood out:

- **The API suite was slow**, and it's the suite you run most. Seventy seconds is long enough to stop running it.
- **Browser testing was manual.** Every stage ended with a hand-written script that clicked through the new feature, and then the script was thrown away. Nothing stopped Stage 13 from breaking Stage 9.
- **The job worker's live loop was untested.** Tests called `drain()`, a helper that runs queued jobs one by one. The code production actually runs (`start()`, the loop, LISTEN/NOTIFY, `stop()`) sat at 58% coverage.
- **Nothing checked accessibility** beyond the care taken while writing components.

---

## 4. Faster feedback: a database per test worker

Vitest can run test files in parallel, one per CPU core. The API tests couldn't, because they all shared one database and each file **truncates** tables in `beforeEach`. Two files running at once would wipe each other's data mid-test.

The usual fixes:

| Approach                                   | How                                          | Problem for us                                                                                                        |
| ------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Wrap each test in a transaction, roll back | Never commit; the database forgets           | Our code uses its own transactions, `LISTEN/NOTIFY` (delivered only on commit) and a worker that needs committed rows |
| Unique data per test                       | Every test makes its own users and household | Possible, but every existing test would need rewriting, and global tables (jobs) still collide                        |
| **One database per worker**                | Worker _n_ gets `ledgerly_api_test_n`        | Creating and migrating N databases is slow… unless you copy one                                                       |

We chose the third, using a Postgres feature that makes it cheap: **template databases**. `CREATE DATABASE x TEMPLATE y` copies `y` at the file level, which takes milliseconds, compared with seconds to run every migration again.

```ts
// apps/api/src/test/global-setup.ts (runs once, before any worker starts)
await template.query(
  "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;",
);
await runMigrations(templateDatabase.url); // ledgerly_api_test: migrated ONCE

for (let worker = 1; worker <= TEST_WORKERS; worker++) {
  const name = `${templateDatabase.name}_${worker}`;
  await admin.query(`drop database if exists "${name}" with (force)`);
  await admin.query(`create database "${name}" template "${templateDatabase.name}"`); // milliseconds
}
```

Each worker finds its own copy through `VITEST_POOL_ID`, a number Vitest gives each worker:

```ts
// apps/api/src/test/database.ts
export const API_TEST_DATABASE_URL = withDatabase(
  TEMPLATE_DATABASE_URL,
  `${templateDatabase.name}_${process.env.VITEST_POOL_ID ?? "1"}`,
);
```

No test changed. Every helper already read `API_TEST_DATABASE_URL`, so they all now get their worker's database. The suite went from **70 s to 25 s** on a 4-core machine. The worker count is `min(4, cores)`, overridable with `TEST_WORKERS`, so a laptop doesn't open dozens of database connections.

The safety guard from earlier stages stays: the setup refuses to touch any database whose name doesn't contain `test`.

> **Why not do the same for the `db` package?** Its suite takes 12 s. Turborepo already runs all packages at the same time, so the slowest package, the API at ~25 s, sets the total. Making `db` faster wouldn't make `pnpm test` faster. Measure the critical path before optimising.

---

## 5. Coverage that means something

**Code coverage** measures which lines (statements, branches, functions) ran during the tests. We use V8's built-in coverage (`@vitest/coverage-v8`), which counts what the JavaScript engine actually executed, with no code instrumentation.

Coverage answers exactly one question: **what did no test even run?** It can't tell you whether the tests that did run checked anything. A test that calls a function and asserts nothing gives 100% coverage of it. That is why coverage is a **map of gaps**, never a score to maximise.

We made the numbers honest in three ways:

1. **Count only what can be tested meaningfully.** Process entry points (`server.ts`, `worker.ts`, which only wire things together and listen on a port), command-line scripts and test helpers are excluded. So are the Zod schemas in `shared/src/api`: they are declarations, and every API test exercises them, but in another package's run. Each exclusion is commented in its `vitest.config.ts`.
2. **A ratchet, not a target.** Each package has thresholds set just under today's numbers. CI fails if coverage _drops_, so new code can't quietly arrive without tests, but nobody is pushed to write empty tests to hit an arbitrary 90%.
3. **Mutation checks.** For each important new test we broke the code it protects and watched it fail. For example, we commented out the worker's `LISTEN` call, and the new wake-up test failed with `not done within 2000 ms`. A test that survives a mutation tests nothing. One of ours did survive (§8), and we fixed the test.

```ts
// apps/web/vitest.config.ts
coverage: {
  provider: "v8",
  include: ["src/**/*.{ts,tsx}"],
  exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
  // Components are covered by the Playwright suite (e2e/); this floor guards the unit-tested logic.
  thresholds: { statements: 12, branches: 11, functions: 7, lines: 12 },
},
```

The web app's 12% looks alarming and is fine. Its components are now exercised by the browser suite, which V8 coverage in Vitest can't see. The number to watch is the logic in `lib/`, where it's high.

The gap the map pointed to was `jobs/worker.ts` at 58%; §7 fixes it.

---

## 6. Property-based testing

An ordinary **example-based** test checks one input you chose: `parseMoney("1,234.50", "USD")` should be `123450`. You only test the cases you thought of, and bugs live in the cases you didn't.

A **property-based** test states a rule that must hold for **every** input, and a library generates hundreds of random inputs to try to break it. We use [fast-check](https://fast-check.dev). When it finds a failing input, it **shrinks** it: it tries smaller and simpler variations until it reaches the minimal input that still fails, and reports that.

The hard part is finding good properties. The useful shapes:

| Shape             | Rule                                                          | Ledgerly example                                                                          |
| ----------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Round trip**    | `decode(encode(x)) === x`                                     | `parseMoney(formatMoney(n))` gives back `n`; a date written in any bank format reads back |
| **Never crashes** | Any input gives a valid output or a clean "no"                | `applyMapping` turns **any** CSV row into a valid transaction or an error message         |
| **Oracle**        | Fast code agrees with slow, obviously-correct code            | `nextRecurringDate` vs walking forward one day at a time                                  |
| **Invariant**     | A quantity is conserved                                       | With rollover, remaining = everything budgeted − everything spent                         |
| **Metamorphic**   | Changing the input a known way changes the output a known way | Spending more never makes a budget's status look better                                   |

Generators are composable. This one writes a date the way some bank might, choosing order, separator, zero-padding and year length:

```ts
// packages/shared/src/domain/csv-import.property.test.ts
const renderedDate = fc
  .record({
    iso: isoDate,
    format: fc.constantFrom("YMD", "MDY", "DMY"),
    sep: fc.constantFrom("/", "-", "."),
    pad: fc.boolean(),
    shortYear: fc.boolean(),
  })
  .map(({ iso, format, sep, pad, shortYear }) => {
    /* "3/14/26", "14.03.2026", … */
  });

it("reads back every date, in every format a bank might write it", () => {
  fc.assert(
    fc.property(renderedDate, ({ iso, format, text }) => {
      expect(parseImportDate(text, format)).toBe(iso);
      expect(detectDateFormats([text])).toContain(format);
    }),
    { numRuns: 500 },
  );
});
```

### 6.1 The bug it found in the first second

The very first property, "formatting then parsing gives back the same amount, for every safe integer", failed on its second generated input:

```
Counterexample: [7059166453011543, "USD"]
expected 7059166453011544 to be 7059166453011543
```

`formatMoney` displayed the amount **one cent too high**. The cause:

```ts
new Intl.NumberFormat(...).format(amount / 10 ** decimals); // 7059166453011543 / 100
```

Division turns an exact integer into a **floating-point** number. Doubles hold about 15–17 significant digits, and `70591664530115.43` needs 16, so it rounded. Rule #1 of this codebase (Stage 1) is that money is never a float. We kept to it everywhere except this last step, display.

Amounts in the trillions aren't realistic for a household. But the rule is a guarantee, and this was the one place it was broken. The fix keeps the value exact all the way into the formatter: `Intl.NumberFormat` accepts a **decimal string**, which it formats exactly.

```ts
// packages/shared/src/money.ts
export function minorToDecimal(amount: MinorUnits, currency: string): string {
  const decimals = currencyDecimals(currency);
  const digits = String(Math.abs(amount)).padStart(decimals + 1, "0");
  const sign = amount < 0 ? "-" : "";
  if (decimals === 0) return sign + digits;
  return `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`; // pure string work
}
```

A search for the same pattern found it once more, in the web app's `minorToInput` (filling the amount field when you edit a transaction). That now uses `minorToDecimal` too. The counterexample stays as an ordinary regression test.

### 6.2 Shrinking makes failures readable

To check that the budget invariant has teeth, we broke rollover on purpose so that overspending was forgiven (`carry = Math.max(0, …)`). fast-check generated budgets with up to 36 months, five amount changes and random spending, then shrank its failure down to:

```
{ start: "1900-01", amounts: [{ effectiveMonth: "1900-01-01", amountMinor: 0 }],
  months: ["1900-01", "1900-02"], spentByMonth: { "1900-01": 1, "1900-02": 0 } }
```

That reads: _a $0 budget, 1¢ spent, look at the next month._ It's the smallest possible story of the bug, found automatically.

### 6.3 The oracle

`nextRecurringDate` is clever: it computes the next due date directly, clamping the 31st to month ends but keeping the anchor. The oracle is deliberately dumb: start the day after, and step forward one day at a time until a day matches the rule. It is too slow for production and too simple to be wrong. Two thousand random rules and start dates, and the two always agree.

**Is randomness a source of flakiness?** No. A property failure is a real bug that the generator just happened to reach. fast-check prints the **seed** and **path** with every failure, so you can replay exactly that case. Passing the seed back, for example `fc.assert(…, { seed: -1047449299, path: "1:6:2" })`, reproduces it every time.

---

## 7. Testing the worker as it really runs

The job worker (Stage 10) had good tests of its **logic**: retries, backoff, leases, SKIP LOCKED. All of them called `drain()`. Four new tests start the real loop:

| Test                                              | What it proves                                                                                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wakes on NOTIFY instead of waiting for the poll   | With a **one-minute** poll interval, a job enqueued after start runs within 2 s, so `LISTEN` must have woken the worker.                                                                                          |
| Never runs more jobs at once than its concurrency | Six 50 ms jobs at concurrency 2: the peak concurrent count is exactly 2.                                                                                                                                          |
| `stop()` hands unfinished jobs back               | A handler that ignores the abort signal: after `stop(100)`, its job is `queued` again, unlocked, with the attempt counted. When the handler finally returns, its late "succeeded" must **not** overwrite the row. |
| Asks running jobs to stop via their AbortSignal   | A polite handler sees `abort` and `stop()` returns in well under a second, not after the 25 s timeout.                                                                                                            |

Two techniques make these tests reliable rather than timing-dependent:

- **Deferred promises instead of sleeps.** The test waits on a promise the job resolves (`ran.promise`), wrapped in a timeout that only exists to fail the test. It never waits for "probably long enough".
- **Proving the negative with a long timer.** The first test passes only if something other than polling woke the worker. We confirmed this by deleting the `LISTEN` line, and the test failed.

`worker.ts` coverage: **58% → 93%**.

---

## 8. Time zones: run the tests somewhere else

CI servers run in UTC. In UTC, the most common date bug in JavaScript can't happen:

```ts
new Date("2026-03-14"); // midnight UTC…
new Date("2026-03-14").getDate(); // …which is the 13th in California
```

So a test suite that runs only in UTC can't catch it, however many date tests it has. We set a default zone for the web and shared suites, in the config so that it applies before any module loads:

```ts
// apps/web/vitest.config.ts and packages/shared/vitest.config.ts
process.env.TZ ??= "America/Los_Angeles";
```

This came from a **mutation that survived**. The first version of `dates.test.ts` changed the zone in `beforeAll`. We removed `timeZone: "UTC"` from the date formatter, expecting the test to fail, and it passed. The formatter is created when the module is **imported**, before `beforeAll` runs, so it never saw the new zone. Moving the setting into the config fixed the test, and the mutation now fails with `Expected "Mar 14", Received "Mar 13"`.

We also ran **every** suite at UTC−8 and at UTC+14 (`Pacific/Kiritimati`, the earliest time zone on Earth). Everything passes in both. The `??=` means you can still pick a zone: `TZ=Pacific/Kiritimati pnpm test`.

---

## 9. End-to-end tests with Playwright

[Playwright](https://playwright.dev) drives real browsers. Our suite runs Chromium against the **whole system as it ships**:

```
                    ┌──────────────── e2e/scripts/servers.ts ───────────────┐
Playwright ─► web (next start, :3100) ─/api─► API (node dist/server.js, :4100) ─► Postgres
 (Chromium)                                     worker (node dist/worker.js)  ─►  ledgerly_e2e_test
                                                                                   (fresh every run)
```

`pnpm e2e` builds the API and the web app, then Playwright starts the servers (its `webServer` option), waits until `/health/ready` and `/login` respond, runs the tests and stops everything.

### 9.1 Decisions, and why

**Production builds, not dev servers.** Dev mode compiles pages on first visit (slow, and timing varies) and behaves differently in ways that matter: strict-mode double rendering, insecure cookies, unminified code. As in Stage 12: test what you ship.

**Its own ports and database.** Port 3100/4100 and `ledgerly_e2e_test`, recreated from scratch every run. The suite can run while `pnpm dev` is up, and never touches your data. The reset script refuses any database that isn't local or whose name lacks `test`.

**A separate web build.** _(Stage 14 later removed the need for it by moving the proxy to request time; see [§3 there](./stage-14-deployment-and-operations.md#3-build-once-run-anywhere).)_ This was the first surprise. Next.js resolves `rewrites()`, our `/api → API` proxy, at **build** time and writes the target into `.next/routes-manifest.json`. A normal build points at port 4000. So `scripts/build-web.ts` builds into `apps/web/.next-e2e` with `API_URL` pointing at port 4100, and your usual `.next` stays untouched.

The second surprise followed straight away. Server Components call the API **directly** (`lib/api/server.ts`) and read `API_URL` at **runtime**. The first test run showed "This page couldn't load" right after sign-up: the server-rendered dashboard was calling port 4000. **The same setting is read in two places, at two different times.** That's a classic deployment trap, and Stage 14 will meet it again with real hosting. The config now passes `API_URL` to both, and says why.

**Rate limiting off, for this stack only.** Every test signs up a user from the same IP within seconds, and the sign-up limit would answer 429. Rate limits have their own integration tests in the API suite. Turning a protection off in a test environment is fine as long as something else tests the protection.

### 9.2 Test isolation: a fresh user per test

Every test gets a **brand-new user and household**, created through the API in a few milliseconds:

```ts
// e2e/src/fixtures.ts
export const test = base.extend<Fixtures>({
  // page.request shares the page's cookies: signing up here signs the browser in.
  user: async ({ page }, use) => use(await signUp(page.request)),
  account: async ({ user, userApi }, use) => {
    await use(await userApi.post(`/households/${user.householdId}/accounts`, { … }));
  },
});

test("adding an expense…", async ({ page, user, account }) => { … });
```

Playwright's **fixtures** are set-up functions that tests request by name. A test that asks for `account` automatically gets `user` too. Because nothing is shared:

- tests run **in parallel** and in any order;
- one failure can't cascade into others;
- there's no cleanup to forget.

**Set up through the API, test through the UI.** The budget test creates its budget by clicking, because that's what it's about. But the $120 grocery transaction that pushes it over budget comes from an API call, like another device would send it. Driving the UI only for the part under test keeps tests fast and keeps unrelated UI changes from breaking them.

### 9.3 Finding things the way users do

```ts
const row = (page: Page, description: string) =>
  page.getByRole("list", { name: "Transactions" }).getByRole("button", { name: description });

await sheet.getByLabel("Amount").fill("18.40");
await expect(row(page, "Bike repair")).toContainText("−$18.40"); // a real minus sign
```

Tests find elements by **role and accessible name**: the same information a screen reader announces. No CSS classes, no `data-testid`. This makes tests robust to restyling, and it doubles as an accessibility check. If a button has no name, the test can't find it. The first attempt looked for a `grid` of `row`s. The page snapshot showed the list is a `list` of `listitem`s with a button per transaction, which is a perfectly good structure, so the test changed, not the app.

**No sleeps.** Every Playwright assertion **retries** until it passes or times out (10 s here). `await expect(budget).toContainText("Over budget")` waits exactly as long as the change takes to arrive.

### 9.4 The journeys

| Spec            | What a user does                                                                                                                    | Layers exercised                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `auth`          | Signs up, signs out, signs in; follows a deep link through the login page; mistypes a password                                      | Proxy, cookies (`__Host-`, Secure), redirects, no account enumeration |
| `transactions`  | Adds an expense; searches (the search lives in the URL); deletes and undoes; opens the form before accounts load                    | Optimistic updates, URL state, undo, a race (§12)                     |
| `budgets`       | Creates a budget; spending elsewhere turns it **red with an alert, without a reload**                                               | DB trigger → job → worker → notification → NOTIFY → SSE → UI          |
| `imports`       | Uploads a bank CSV (with a junk line), reviews the mapping, imports, undoes                                                         | File upload, shared parsing, background job, progress                 |
| `household`     | Invites a partner, who signs up from the link in a **second browser** and joins; both screens stay in sync; presence comes and goes | Invitations, real-time, presence, two sessions at once                |
| `accessibility` | (Scans every page, §10)                                                                                                             |                                                                       |

The budget test is the most valuable single test in the project. To pass, a database trigger must enqueue a job, the worker must claim and run it, a notification must be written, Postgres must NOTIFY the API, and the API must push it over Server-Sent Events. Then the browser must refetch and re-render. Each step has its own unit or integration test. Only this test proves they're connected.

**Cost:** 14 tests take about 45 s with two browser workers (about 65 s including both builds). That's an order of magnitude slower per test than the API suite, which is why there are 14 of them and not 400. End-to-end tests are for **journeys and wiring**; edge cases belong lower down.

---

## 10. Accessibility checks

[axe-core](https://github.com/dequelabs/axe-core) is the engine behind most accessibility checkers. Inside Playwright it scans the live page, including content rendered by JavaScript, against WCAG 2.1 A and AA rules. We scan every page of the app, filled with real data, in **light and dark mode**, where contrast problems often hide in only one of the two.

The first run failed on every page. The findings, all fixed:

| Finding                                                                              | Who it hurt                                                          | Fix                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Avatar initials**: white on amber, 2.2:1 contrast (WCAG asks 4.5:1)                | Anyone with low vision, or a sunny screen                            | The colour became a **tint** behind normal ink (passes in both themes)                                                                                                                      |
| **Charts were `role="img"`**, and an image's children are hidden from assistive tech | Screen-reader users: the focusable chart areas announced **nothing** | The chart is a labelled `group`; the line chart's scrubber is a `slider` whose value text reads the point ("November 2026: Income $0.00, Spending $84.20"); each column is a labelled `img` |
| **Category bars**: `aria-label` didn't contain the visible text                      | Voice-control users ("click Food") — WCAG 2.5.3 _Label in Name_      | Removed the label; visible text is the name, and "Show subcategories of" is screen-reader-only text                                                                                         |
| **Budget rows**: `aria-label="Edit Groceries budget"` **replaced** the row's content | Screen-reader users never heard the amount spent or "Over budget"    | The name is now "Edit" (screen-reader-only) + everything visible on the row                                                                                                                 |
| **Time-zone `<select>` had no label**                                                | Screen-reader users heard "combo box" with no idea what for          | A `NativeSelect` that takes its label from the surrounding `<Field>`, like `Input` does                                                                                                     |

The chart finding is worth remembering. `role="img"` on an SVG chart is the textbook advice for a **static** chart. Ours is interactive, and ARIA defines an image's children as **presentational**: whatever is inside no longer exists for assistive technology. Keyboard focus landed on an element a screen reader treated as nothing. A correct-looking pattern applied in the wrong context hid a whole feature.

**What automated checks can't do.** Studies of real audits put automated tools at catching somewhere between a third and a half of accessibility issues. They can see a missing label; they can't judge whether the label makes sense, or whether a flow works with a keyboard alone. Two things in this suite help with the rest. Every journey finds elements by role and name. And the budget test checks the meter's `aria-valuenow`, the number a screen reader announces. A manual pass with a real screen reader is still part of releasing anything big.

---

## 11. The API contract snapshot

The API's OpenAPI document (Stage 4) is generated from the same Zod schemas that validate every request. It describes exactly what the API accepts and returns: 50 paths, 70 operations, 120 schemas. We now **commit** it, as `apps/api/openapi.json`, and a test compares it with the live document:

```ts
// apps/api/src/contract.test.ts
const spec = (await ctx.app.inject({ method: "GET", url: "/openapi.json" })).json();
spec.info.version = "<version>"; // moves every release; not part of the contract
await expect(`${JSON.stringify(spec, null, 2)}\n`).toMatchFileSnapshot("../openapi.json");
```

Change a route, a field, a status code or an error format, and the test fails until you accept the change (`vitest -u`). The point isn't to forbid change. It's that **a contract change can't arrive unnoticed**: it appears in the pull request as a readable diff of `openapi.json`, and the reviewer asks "will this break a client?"

To see it work, we made `archived` optional in the Account schema. The test failed with:

```diff
- "archived",
- "archived",
```

`archived` dropped out of two `required` lists. Making a response field optional looks harmless and is **breaking**: a client that reads `account.archived` without checking for `undefined` now has a bug. That's exactly the kind of change a reviewer should see.

**Why not consumer-driven contract testing (Pact)?** Pact shines when separate teams own the client and the server. Ours share a repository and **the same Zod types**, so the web app is already checked against the API by the TypeScript compiler. The snapshot protects the clients the compiler can't see: a future mobile app, scripts, integrations.

---

## 12. Flaky tests

A **flaky** test sometimes passes and sometimes fails with no code change. Flaky tests are corrosive. People learn to re-run CI until it's green, and soon a real failure gets re-run away too. The industry answer is to **treat flakiness as a bug**, with one of three causes: the test, the environment, or the product.

Our policy:

- **Retries in CI only, and visible.** Locally a failure fails, loudly, the first time. In CI a failed test retries up to twice, and a test that passes on retry is reported as **flaky**, never silently green. The retry records a trace.
- **Hunt flakes deliberately.** Run the suite many times, in parallel, with retries off.

### 12.1 The flake we caught

The first full cold-start run of the browser suite in CI mode reported:

```
✘ adding an expense shows it at once…
✓ adding an expense shows it at once… (retry #1)
1 flaky · 12 passed
```

The page snapshot from the failure showed the transaction form with **Account: "Choose…"** and the error **"Choose an account"**, though the household has exactly one account. The sheet had opened before the accounts request returned. The form picks its default account when it **opens**, so accounts arriving a moment later were never used.

This wasn't a test problem. It's a real bug: press `N` the instant the page appears and you hit it too. The fix wasn't to retry until green; it was to **make the race happen every time**. Playwright can intercept network requests, so the new test delays just the accounts response:

```ts
await page.route("**/api/v1/households/*/accounts*", async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await route.continue();
});
await page.goto(`${user.home}/transactions`);
await page.getByRole("button", { name: /New transaction/ }).click();
await expect(page.getByRole("dialog").getByRole("combobox", { name: "Account" })).toHaveText(
  account.name,
);
```

It failed 100% of the time (`Received: "Choose…"`). The fix fills in the default when accounts arrive, and never overwrites a choice the user already made:

```tsx
useEffect(() => {
  if (!open || form.getValues("accountId")) return;
  const fallback = defaults(mode, activeAccounts).accountId;
  if (fallback)
    form.setValue("accountId", fallback, { shouldValidate: form.formState.isSubmitted });
}, [open, mode, activeAccounts, form]);
```

**Turn "sometimes" into "always", then fix it.** That's the whole technique.

### 12.2 The hunt

| Run                                               | Result                                                   |
| ------------------------------------------------- | -------------------------------------------------------- |
| Browser suite × 5, 4 parallel workers, no retries | **70 / 70** passed (2.3 min)                             |
| API and db suites × 3                             | all passed                                               |
| Every suite at UTC−8 (`America/Los_Angeles`)      | all passed                                               |
| Every suite at UTC+14 (`Pacific/Kiritimati`)      | all passed (after fixing one over-strict test assertion) |

**A known residual risk:** tests that use "today" (budgets, imports) could misbehave if a run straddles midnight on the last day of a month. The browser and API both use UTC in the e2e stack, so they agree on what "this month" is, but a test that starts on the 31st at 23:59:59 could still see two different months. Real fixes, such as a controllable clock in the API, cost more than the risk is worth today, and we've written it down instead of pretending it isn't there.

---

## 13. Continuous integration

`.github/workflows/ci.yml` now has three jobs, running in parallel:

| Job           | Runs                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| **check**     | Format, migration drift, `lint typecheck test:coverage build` across all packages. Coverage ratchets enforced. |
| **e2e** (new) | Postgres service → install Chromium (cached) → `pnpm e2e` → upload the Playwright report as an artifact.       |
| **security**  | Dependency audit and secret scan (Stage 5).                                                                    |

Details that matter:

- **The browser is cached**, keyed by the lockfile (so a Playwright upgrade refreshes it). On a cache hit, only the system libraries are installed.
- **The report is uploaded even when tests fail** (`if: !cancelled()`), because that's when you need it. It holds screenshots and a **trace** of each retried test: a step-by-step recording with DOM snapshots, network requests and console output that you can scrub through like a video.
- **`forbidOnly` in CI.** A `test.only` left in by accident would silently skip every other test. In CI, it's an error.

**Why the load test and Web Vitals budgets from Stage 12 are _not_ in CI.** Timing checks on shared CI machines are flaky by construction. In Stage 12, two runs of the same code on the same machine differed by more than our optimisations did, until we compared them side by side. A budget that fails at random would train everyone to ignore it. Those tools stay in `tools/perf`, to run on a quiet machine before a release; correctness checks go in CI.

---

## 14. Results

### Tests

| Package   | Before  | After   | Added                                                          |
| --------- | ------- | ------- | -------------------------------------------------------------- |
| `shared`  | 70      | 89      | 19 property tests (≈9,000 generated cases per run)             |
| `db`      | 33      | 33      | —                                                              |
| `api`     | 179     | 184     | 4 worker-loop tests, 1 contract snapshot                       |
| `web`     | 80      | 85      | Dates (in a west-of-UTC zone), money inputs                    |
| `e2e`     | 0       | 14      | 10 journey tests + 4 accessibility scans (10 pages × 2 themes) |
| **Total** | **362** | **405** |                                                                |

### Time

| Suite                                                                    | Before       | After                     |
| ------------------------------------------------------------------------ | ------------ | ------------------------- |
| API                                                                      | 70 s         | 25 s                      |
| All unit + integration (`pnpm test`, packages in parallel, incl. builds) | not measured | 40 s                      |
| Browser suite (14 tests)                                                 | manual       | ~45 s (~65 s with builds) |

### Line coverage

| Package  | Before | After | Note                                                                                                                                                                              |
| -------- | ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared` | 64.6%  | 99.6% | All from no longer counting schema declarations: the logic was already ~99.5% covered. The property tests add **depth** (thousands of inputs per line), which coverage can't show |
| `db`     | 81.3%  | 81.3% |                                                                                                                                                                                   |
| `api`    | 87.4%  | 92.0% | Partly from excluding the two process entry points; the real gain is `worker.ts` 58% → 93%                                                                                        |
| `web`    | 12.0%  | 12.6% | Components are covered by the browser suite, which this number can't see                                                                                                          |

---

## 15. What testing caught this stage

Every new kind of test found something the others had missed:

1. **`formatMoney` was a cent off for huge amounts** (property test, §6.1). Money went through a float at the very last step. The same pattern was in `minorToInput`. Both now use exact string arithmetic.
2. **The account field could stay empty** (a flaky e2e test, §12.1). A real race between opening the form and loading accounts.
3. **The household time zone showed "Africa/Abidjan" for UTC households** (an e2e screenshot). `Intl.supportedValuesOf("timeZone")` lists geographic zones only and leaves out `"UTC"`. A `<select>` whose value isn't among its options displays the first option instead. Every household created without a browser time zone showed the wrong setting. `UTC` is now the first option, and the household test asserts the field reads `UTC`.
4. **Five accessibility problems** (axe, §10), including interactive charts that were invisible to screen readers.
5. **The web server needs `API_URL` at runtime as well as build time** (e2e, §9.1). A configuration trap, found before it could reach a real deployment.
6. **A test that couldn't fail** (mutation check, §8). The time-zone test passed with the bug put back. Fixed by setting the zone before modules load.
7. **A config that overrode the experiment** (time-zone runs). Forcing `TZ` in the Vitest config silently ignored `TZ=Pacific/Kiritimati` on the command line. It's now a default (`??=`), and one over-strict assertion ("the zone must be _west_ of UTC") was relaxed to "not UTC".
8. **Generated files and formatters disagree.** Prettier reformatted `openapi.json`, which broke the snapshot. Generated files belong to their generator, so it's now in `.prettierignore`.

---

## 16. Run it yourself

```bash
# Unit + integration tests (Postgres running: pnpm db:up)
pnpm test
pnpm test:coverage                      # with coverage; open <package>/coverage/index.html

# A different time zone
TZ=Pacific/Kiritimati pnpm test

# Browser tests (once per machine: download Chromium)
pnpm --filter @ledgerly/e2e exec playwright install chromium
pnpm e2e                                # build, start everything, run
pnpm e2e:ui                             # watch tests run; pause, step, inspect

# Hunt flakes: repeat everything, no retries
pnpm e2e:build
pnpm --filter @ledgerly/e2e exec playwright test --repeat-each=5 --retries=0

# Accept an intentional API contract change
pnpm --filter @ledgerly/api exec vitest run src/contract.test.ts -u
git diff apps/api/openapi.json          # …and read what you changed

# Replay a property-test failure: copy seed and path from the failure message
#   fc.assert(property, { seed: -1047449299, path: "1:6:2" })
```

---

## 17. Exercises

1. **Mutation-test a test.** Pick any test in `apps/api/src/modules/budgets/budgets.test.ts`. Break the code it protects in the subtlest way you can think of. Does it fail? If not, improve the test.
2. **A new property.** `addMonths` and `monthDiff` have properties. Write one for `todayIn(timeZone, now)`: for any instant and zone, how far from the UTC date can the answer be? (Hint: zones range from UTC−12 to UTC+14.)
3. **Make the oracle find something.** Change `nextRecurringDate` so the 31st becomes the 30th in 30-day months _and stays the 30th afterwards_. Run the oracle property. How small is the shrunk counterexample?
4. **A new journey.** Write an e2e test for goals: create a goal, add money to its account through the API, and check that the progress updates without a reload.
5. **Delay something else.** Use `page.route` to delay `/categories` by two seconds, then open the transaction form. Is there a second race like §12.1?
6. **Break accessibility on purpose.** Remove the `aria-label` from the transactions search box (`filters-bar.tsx`). Which tests fail: the axe scan, the journeys, or both? Why? (Hint: does the input have a `<label>`, or only a placeholder?)
7. **Read a trace.** Make a test fail, run with `--trace on`, and open the trace with `pnpm --filter @ledgerly/e2e exec playwright show-trace test-results/…/trace.zip`. Find the network request that the failing step waited for.

---

## 18. Glossary

| Term                      | Meaning                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Unit test**             | Tests one function or module in isolation, in memory. Milliseconds.                                          |
| **Integration test**      | Tests several parts together with real dependencies, e.g. the API with a real database.                      |
| **End-to-end (E2E) test** | Tests the whole running system through its real interface, here a browser.                                   |
| **Test pyramid / trophy** | Rules of thumb for how many tests to have at each level.                                                     |
| **Fixture**               | Set-up a test asks for by name (a user, an account); Playwright builds and tears it down.                    |
| **Template database**     | A Postgres database used as the starting copy for `CREATE DATABASE … TEMPLATE`, a fast file-level clone.     |
| **Code coverage**         | Which statements, branches and functions ran during the tests. A map of gaps, not a quality score.           |
| **Ratchet**               | A threshold set at the current level, so a number can improve but not get worse.                             |
| **Mutation check**        | Deliberately breaking code to confirm a test fails. Automated as _mutation testing_ (e.g. Stryker).          |
| **Property-based test**   | States a rule for all inputs; a library generates many inputs to try to break it.                            |
| **Arbitrary / generator** | fast-check's description of how to produce random values of some shape.                                      |
| **Shrinking**             | Reducing a failing input to the smallest one that still fails.                                               |
| **Test oracle**           | An independent (often slow, simple) way to compute the right answer, to compare against.                     |
| **Flaky test**            | A test that passes and fails without any code change.                                                        |
| **Trace (Playwright)**    | A recording of a test run: actions, DOM snapshots, network, console. Opened in the trace viewer.             |
| **axe-core**              | An engine of automated accessibility rules (WCAG).                                                           |
| **WCAG**                  | Web Content Accessibility Guidelines; levels A and AA are the usual legal and industry baseline.             |
| **Accessible name**       | What assistive technology announces for an element: its label, or its text content.                          |
| **Contract test**         | Checks that the interface between two systems, here the API's OpenAPI document, hasn't changed unexpectedly. |
| **Snapshot test**         | Compares output with a stored copy; a difference fails until it's reviewed and accepted.                     |

---

## 19. What's next

**Stage 14: Deployment & operations.** Ledgerly works, is fast, and is now tested at every level. Next it goes live. We'll build container images and run the database migrations safely. We'll handle configuration and secrets per environment; the `API_URL` lesson from §9.1 will matter. We'll add structured logging, metrics and tracing, health checks and alerts, backups you've actually restored, and a deployment pipeline that runs this stage's suite before anything reaches production.
