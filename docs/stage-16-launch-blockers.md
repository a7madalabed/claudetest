# Stage 16 — Launch Blockers

> **Goal of this stage:** fix what an outside review found standing between Ledgerly and its first real users. Nothing new for its own sake: each change answers a specific way the app could fail, be attacked, or confuse someone, and each comes with a test that failed before the fix.
>
> **What you'll learn:** why a GitHub Actions trigger can deploy a stranger's code; how a background worker can crash on its own retry; why test fixtures can hide a broken product; how to stop attempt limits from becoming a weapon; why "does this text start with `/`?" is not a URL check; why a missing error message is worse than an error; and how to make alerts and backups tell you when they stop working.

---

## Table of contents

1. [What we built](#1-what-we-built)
2. [The review that started it](#2-the-review-that-started-it)
3. [Deploy only what is really on `main`](#3-deploy-only-what-is-really-on-main)
4. [A crash hidden in a retry](#4-a-crash-hidden-in-a-retry)
5. [The first five minutes](#5-the-first-five-minutes)
6. [One currency per household](#6-one-currency-per-household)
7. [Attempt limits that can't be turned against the owner](#7-attempt-limits-that-cant-be-turned-against-the-owner)
8. [An open redirect, and why text checks fail](#8-an-open-redirect-and-why-text-checks-fail)
9. ["We couldn't load this"](#9-we-couldnt-load-this)
10. [Alerts that reach a person, backups that leave encrypted](#10-alerts-that-reach-a-person-backups-that-leave-encrypted)
11. [Found while checking: a password in the URL](#11-found-while-checking-a-password-in-the-url)
12. [Left for Stage 17](#12-left-for-stage-17)
13. [Results](#13-results)
14. [Run it yourself](#14-run-it-yourself)

---

## 1. What we built

| Area            | Change                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Deploys         | `deploy.yml` deploys only commits pushed to **this** repository's `main`, never a fork's pull request                             |
| Background jobs | A retry that meets an identical queued job hands the work over instead of crashing the worker                                     |
| First run       | Add, edit, archive and delete accounts in the app; "add your first account" wherever one is needed; starter categories everywhere |
| Money           | A household keeps its books in one currency: accounts in another are refused                                                      |
| Sign-in         | One address can't lock an account; the owner's own browsers are never locked out                                                  |
| Redirects       | `?next=` is checked by a URL parser, closing an open redirect                                                                     |
| Errors          | Every data page says when it couldn't load, with "Try again"                                                                      |
| Operations      | Alertmanager emails alerts; off-site backups are encrypted with `age`; backups and drills check in with a dead man's switch       |
| Forms           | Sign-in forms use `method="post"`: a password can't end up in a URL                                                               |

---

## 2. The review that started it

Before launch, the whole codebase was reviewed by someone who had never seen it, with one rule: **prove every finding** with a test, a script or a browser session. The verdict was "not ready yet", for three reasons:

1. A new user could sign up and then do **nothing**: there was no way to add a bank account in the app.
2. Once automatic deploys were switched on, **anyone** could get their code deployed by opening a pull request.
3. The background worker could **crash itself**, and a single attacker could keep any user out of their account.

The review also checked the claims earlier stages made. Most held: no household can see another's data, money is never a float, the throttle can't be raced, the CSP is what it says, backups restore. Two didn't: "0 failed requests during a deploy" (one request failed per deploy, §12) and "a lockout is a 15-minute nuisance" (§7).

---

## 3. Deploy only what is really on `main`

`deploy.yml` runs when the CI workflow finishes:

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
```

It reads like "after CI passes on main". It isn't. `branches` compares the **name** of the branch CI ran on. CI also runs for pull requests, and a pull request from someone's fork comes from **their** branch, which they can call `main`. Their CI run passes (it's their code, tests included), and the deploy job then checks out **their commit**, pushes images built from it to our registry, and runs **their** `deploy/` scripts on our server over SSH.

The fix checks what actually happened, not what a name suggests:

```yaml
github.event.workflow_run.event == 'push' &&
github.event.workflow_run.head_branch == 'main' &&
github.event.workflow_run.head_repository.full_name == github.repository
```

The runbook now makes a second lock mandatory, not optional: the `production` environment needs a required reviewer and only allows `main`.

> **The lesson:** in CI configuration, a filter that matches a _name_ is not a security check. Ask "who controls this value?" For a branch name in a fork, the answer is "anyone".

---

## 4. A crash hidden in a retry

Some jobs carry a **singleton key**: "evaluate the budgets of household X for November" must only be queued **once** at a time, so a burst of 50 edits runs it once. A unique index enforces it, but only for _queued_ jobs, on purpose: while one copy runs, a new edit must be able to queue the next one.

Now follow one job:

1. Budget evaluation for household X is **running**.
2. A partner adds a transaction. A trigger queues a **second** evaluation (allowed: the first isn't queued, it's running).
3. The first one hits a temporary error (a timeout) and asks to be **retried**, i.e. queued again.
4. Two queued copies. The database refuses: `duplicate key … "jobs_singleton_key"`.
5. Nothing caught that error. In Node.js an uncaught promise rejection **ends the process**, and every other job the worker was running stays stuck as "running" until its lease runs out.

The fix, in `apps/api/src/jobs/worker.ts`:

- **Hand the work over.** Same key means same work. If a twin is already queued, it takes over (made due no later than our retry would have been) and our row is closed with a note naming it: `statement timeout (handed over to job 01a1…)`.
- **Never let bookkeeping kill the process.** If recording a job's outcome fails for any reason, it's logged, and the job is retried when its lease expires.
- **Shutdown does the same**, one job at a time, so a deploy can't hit the same collision.

Three tests, each red before the change. The proof script from the review, which used to end with `exit code 1`, now leaves the worker running.

> **The lesson:** "retry" is a write, and writes can fail. Every path that records an outcome needs its own error handling, especially in a long-running process, where one unhandled error takes everything down with it.

---

## 5. The first five minutes

Sign up, and Ledgerly created a household with categories and **no accounts**. Transactions, imports and goals all belong to an account, and the web app had no screen to create one: the API endpoints existed, but nothing called them. A new user landed on a dashboard of `$0.00`, opened "New transaction", and found an empty "Account" list.

**How did 14 stages of tests miss it?** Every browser test got its account from a fixture that calls the API directly (`e2e/src/fixtures.ts`). Fixtures are good for speed and for testing one thing at a time, but here every test **started after the broken step**. So the most important journey in the app, sign up and do something, was never tested.

What changed:

- **Accounts page:** "Add account", an edit button per account (name, type, starting balance), archive and unarchive, delete (the API refuses for an account with history and says to archive it instead), and archived accounts in their own group.
- **Credit cards and loans** ask for the "amount owed" and store it as a negative balance. People think "I owe $450", not "my balance is −$450".
- **`NoAccountsNotice`**: wherever an account is needed but none exists (dashboard, new-transaction sheet, imports, goals), it says what to do and links straight to the new-account dialog. Viewers, who can't add one, are told who can.
- **Starter categories for every household.** Households created from the switcher used to start with none (a code comment said "in a later exercise").
- A new test, `e2e/tests/first-run.spec.ts`, signs up **through the UI**, with nothing set up through the API, adds an account and records an expense.

> **The lesson:** keep at least one test that starts from nothing, exactly as a new user does. If any setup goes through the back door, you aren't testing the front door.

---

## 6. One currency per household

Every total (spending, cash flow, budgets, the transaction summary) adds `amount_minor` across accounts. A JPY account and a USD account would add ¥10,000 (10000 minor units) to $100.00 (also 10000), and show $200.00. A comment in `packages/db/src/queries.ts` already said "sums assume one currency"; nothing enforced it.

Until amounts are converted, the API enforces it: an account's currency defaults to the household's base currency, and any other is refused with `422 currency_not_supported`. It's the smallest change that makes every total correct. Supporting several currencies later means choosing between per-currency totals and conversion, which is a product decision, not a bug fix.

---

## 7. Attempt limits that can't be turned against the owner

Stage 15 limited sign-in attempts at three levels, each against one attack:

| Limit           | Max / 15 min | Stops                               |
| --------------- | ------------ | ----------------------------------- |
| address+account | 5            | one address guessing one password   |
| account         | 20           | many addresses guessing one account |
| address         | 100          | one address trying many accounts    |

Every attempt counted against **all three** before being checked, even an attempt the first limit had already refused. So one address could send 21 wrong passwords in a second and fill the **account** counter. The real owner, from anywhere, then got "Too many attempts". Repeat every 15 minutes and the owner is locked out for good. The review proved it: after 21 requests from 203.0.113.50, the owner's correct password from 198.51.100.9 got a 429.

Two changes in `apps/api/src/modules/auth/throttle.ts` and `auth.routes.ts`:

1. **Narrowest limit first, and stop there.** An attempt refused by "this address + this account" isn't counted against the account. One address can now add at most 5 to the account counter per window.
2. **Known devices** (OWASP's _device cookie_ defence). After a full sign-in, the browser gets a long-lived, HttpOnly cookie: an HMAC of the email with the server's key. It can't be forged and it's stored nowhere. It grants **nothing** on its own (the password and 2FA are still required); it only exempts that browser from the account-wide limit. A botnet can still trip that limit for browsers that have never signed in, but not for the owner's own devices.

**What we deliberately didn't change:** sign-up still answers "an account with this email already exists". Hiding that means changing sign-up to "check your email to continue" for _everyone_, a real cost for every new user. With the lockout fixed, knowing an address has an account no longer lets anyone keep its owner out, and sign-ups are limited to 10 an hour per address. It's a trade-off, written down so it can be revisited.

---

## 8. An open redirect, and why text checks fail

After signing in, Ledgerly sends you back where you were: `/login?next=/app/…/budgets`. To stop `?next=https://evil.example`, the check was:

```ts
next.startsWith("/") && !next.startsWith("//");
```

Browsers treat a backslash like a slash, so `/\evil.example` passes the check and still means "another site". A link to **our real sign-in page** sent people, the moment they signed in, to a lookalike page ready to ask for their password "again".

The fix is to ask the same question the browser will, with a real URL parser:

```ts
const url = new URL(next, "https://ledgerly.invalid");
return url.origin === "https://ledgerly.invalid" ? url.pathname + url.search + url.hash : "/app";
```

The tests now include backslashes, tabs and newlines (URL parsers drop them, so `/\t/evil` is `//evil`), `javascript:` and `https:evil.example`.

> **The lesson:** never validate a URL by looking at its text. Parse it the way its consumer will, then check the result.

---

## 9. "We couldn't load this"

When a request failed (a server error, a dropped connection), most pages showed **nothing**: Budgets stayed on a grey loading placeholder forever, Goals looked like "you have no goals", and "Upcoming bills" said "Nothing recurring due soon". In a money app that's worse than an error message, because it's a **wrong answer**.

`components/ui/error-state.tsx` gives one consistent answer, "Couldn't load this", a plain reason and a "Try again" button. Its partner, `loadFailed(query)`, is true only when the request failed **and** there's nothing to show: if a background refresh fails, the figures already on screen stay. It's used on Accounts, Goals, Budgets (and bills), Transactions, Imports, Household members, every dashboard widget, and as one banner for the dashboard's headline figures.

`e2e/tests/resilience.spec.ts` breaks each page's request with a 500, expects the message, lets the API recover, and clicks "Try again".

---

## 10. Alerts that reach a person, backups that leave encrypted

Three operational gaps had the same shape: **something could stop working, and nobody would find out.**

**Alerts went nowhere.** Stage 14 wrote 8 alert rules, but Prometheus only _evaluates_ rules. Sending them is Alertmanager's job, and there was none. Now the monitoring profile runs Alertmanager, and `deploy/alertmanager/alertmanager.example.yml` emails one message per kind of problem, repeats every 4 hours while it lasts, and sends "resolved" when it ends. The real config holds an SMTP password, so it lives only on the server: it's git-ignored, **and** excluded from the deploy's `rsync --delete`, which would otherwise erase it on every deploy. We proved the whole path with Mailpit: no API running → about 90 seconds later, an email titled "[FIRING:1] LedgerlyApiDown (api critical)".

**A failed backup was silent.** Cron wrote errors to a log file nobody reads. Now `backup.sh` and `restore-drill.sh` request a **check-in URL** after every success (`BACKUP_HEARTBEAT_URL`, `DRILL_HEARTBEAT_URL`). A "dead man's switch" service (healthchecks.io and others) expects that request every hour or week, and emails you when it **stops**. Silence becomes an alert.

**Off-site copies were readable by anyone holding them.** The dump holds every household's finances, every email address and every password hash, and a storage bucket is one wrong setting away from public. Copies are now encrypted with [`age`](https://age-encryption.org) before they leave the server:

- The server has only the **public** key (`BACKUP_AGE_RECIPIENT`): it can encrypt, not read.
- The **private** key lives in your password manager. It's the only way to read a backup.
- `backup.sh` **refuses** to upload without a key, and decides that before dumping.
- `restore-drill.sh` restores an encrypted copy (`BACKUP_AGE_IDENTITY`), checking the checksum **after** decrypting. The runbook's weekly cron now drills the newest **off-site** copy: what you'd really restore from after losing the server.

Tested end to end: an upload without a key is refused; the uploaded file begins `age-encryption.org/v1` while the local one begins `PGDMP`; the drill restores it (23 tables, every count identical, the API ready) and checks in; a wrong key and a damaged checksum both stop it.

---

## 11. Found while checking: a password in the URL

Re-checking the fixes in a real browser turned up one more. A stale test server served pages whose script files no longer existed, so the pages never "came alive", and submitting the sign-in form produced:

```
/login?email=me%40example.com&password=MY-SECRET-PASSWORD
```

A `<form>` with no `method` is sent as **GET**: its fields go into the URL. Normally React intercepts the submit first, but before the app's JavaScript runs (a slow connection, a script that failed to load, a tab opened just before a deploy replaced the script files) the browser does it alone. That URL then sits in browser history and in Caddy's access log.

All five sign-in-related forms now say `method="post"`. If JavaScript isn't there, the browser sends a POST, and Next simply shows the page again. Once JavaScript runs, nothing changes. The e2e test blocks the app's script files on purpose, submits sign-in and sign-up, and checks the address bar.

> **The lesson:** a page that "only works with JavaScript" still exists for a moment _without_ it. Its HTML should fail safely in that moment.

---

## 12. Left for Stage 17

The review's smaller findings, deliberately kept out of this stage:

- **One failed request per deploy.** At the end of the API's 5-second drain, the web server reuses an idle connection to the old API, and Fastify answers `503` (its default while closing). Measured twice: 1 in 9,253 and 1 in 10,569 requests. Planned fix: `return503OnClosing: false`, then measure again, in CI.
- **One clock.** "Today" comes from the browser (budget month), the household's time zone (alerts, recurring) or UTC (goals, some defaults). The server should always use the household's time zone.
- **Smaller races:** two simultaneous "new budget" requests for a category and its parent; an idempotent create racing itself returning 409 instead of the saved reply; a worker that ignores a failed lease renewal.
- **Categories screen.** New households get starter categories now, but adding or renaming one still needs the API.
- The production and development Compose stacks share the project name `ledgerly`, so trying production locally can replace the dev database container.

---

## 13. Results

| What                                       | Before                      | After                                                |
| ------------------------------------------ | --------------------------- | ---------------------------------------------------- |
| A fork's PR could be deployed              | yes, once auto-deploy is on | no                                                   |
| Worker after "retry meets queued twin"     | process exits (code 1)      | keeps running; work handed over                      |
| New user can add an account in the app     | no                          | yes, with a guided first run                         |
| One address can lock the owner out         | yes (21 requests)           | no; owner signs in (200)                             |
| `/login?next=/\evil.example` after sign-in | goes to evil.example        | stays in the app                                     |
| Page when its data fails to load           | blank, or loading forever   | "Couldn't load this" + Try again                     |
| An alert fires                             | nobody is told              | email (tested with Mailpit)                          |
| Off-site backup                            | plain dump                  | `age`-encrypted; drill restores it                   |
| A backup silently stops                    | unnoticed                   | missed check-in → email                              |
| Sign-in submitted before JavaScript runs   | password in the URL         | POST, nothing in the URL                             |
| Tests                                      | 445                         | **471** (db 35, api 217, shared 89, web 102, e2e 28) |

---

## 14. Run it yourself

```bash
pnpm db:up && pnpm db:migrate
pnpm turbo run lint typecheck test:coverage build
pnpm e2e
```

Then watch the first run: sign up at http://localhost:3000/signup with a new email. The dashboard asks you to add an account, and "New transaction" explains why it can't record anything yet.

To see an alert email, follow the runbook's _Setting up a server_ steps 7–10 on a test machine, then `dc stop worker` and watch Mailpit or your inbox.
