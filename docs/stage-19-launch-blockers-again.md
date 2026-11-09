# Stage 19 — Launch Blockers, Again

> **Goal of this stage:** fix what a second outside review found between Ledgerly (now with its new look) and its first real users. Nothing new for its own sake: each change answers something that was shown to be wrong, with a test that failed before the fix.
>
> **What you'll learn:** why a script can print "passed" and still fail; why four numbers that "add up" must come from one calculation; why a test that only visits the happy path hides whole categories of bugs; what a privacy page may and may not claim; and why an alert for a full disk needs a second alert for the watcher going quiet.

---

## Table of contents

1. [What we built](#1-what-we-built)
2. [The review that started it](#2-the-review-that-started-it)
3. [A drill that passed and failed](#3-a-drill-that-passed-and-failed)
4. [A statement that didn't add up](#4-a-statement-that-didnt-add-up)
5. [Links you couldn't see](#5-links-you-couldnt-see)
6. [Privacy and terms](#6-privacy-and-terms)
7. [The server's disk](#7-the-servers-disk)
8. [Small things](#8-small-things)
9. [Found while fixing, and left for later](#9-found-while-fixing-and-left-for-later)
10. [Results](#10-results)
11. [Run it yourself](#11-run-it-yourself)
12. [What only you can do](#12-what-only-you-can-do)

---

## 1. What we built

| Area       | Change                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| CI         | The restore drill exits `0` when it passes, so CI can go green again and deploys can run                                              |
| Dashboard  | The month statement's four figures come from **one** server calculation; the invented "adjusted" line is gone                         |
| Dashboard  | "In hand today" is now "Net worth today" (a loan or card lowers it, so it isn't cash in hand)                                         |
| Links      | "Create one" is underlined; the accessibility sweep now visits the empty and first-run states it used to skip                         |
| Legal      | Public **Privacy** and **Terms** pages, linked from sign-up; the operator's name and contact come from the server's settings          |
| Operations | A disk-space alert (two levels, plus one for the watcher going quiet); local backups thinned to one per day after two days            |
| Small      | `pnpm db:up` also starts the mail inbox; one minus sign everywhere; the design style guide is not public in production                |
| Home page  | The public front door says what Ledgerly is and how to start; the build-progress page is gone, with the version it showed             |
| Everywhere | Every balance, total and chart is **as of today**: nothing dated later is counted; budget alerts still fire on the day a bill arrives |

---

## 2. The review that started it

Stage 18 gave Ledgerly a new look. Before launch, the whole branch was reviewed again by someone who had never seen it, with the same rule as Stage 16: **prove every finding**. This time that meant running every check, replaying the earlier fixes, and driving the new dashboard in a real browser.

The verdict was "not ready", for three reasons:

1. **CI on `main` was red**, and the deploy workflow only runs after CI is green. Nothing could ever be deployed.
2. **The new dashboard could show wrong money.** A bill dated tomorrow made it say "Net worth −$550" for someone who had $950.
3. **No privacy policy or terms page existed**, for an app that stores strangers' finances.

Everything the earlier stages fixed was still fixed (each was replayed). One of them only worked by luck, which is section 3.

---

## 3. A drill that passed and failed

The restore drill (Stage 14) proves a backup can really be restored. CI's log for the failing run read:

```
✅ restore drill passed: ledgerly-20261105T143350Z.dump is a working backup
##[error]Process completed with exit code 1.
```

It passed, and then failed. The culprit was one line in the script's clean-up code, which runs when the script exits:

```bash
cleanup() {
  ...
  [[ -n "$plain" ]] && rm -f "$plain"
}
```

`$plain` is only set when the backup is **encrypted**. For a plain backup it is empty, so `[[ -n "$plain" ]]` is false, and the whole line counts as "failed". Normally a failed `&&` list doesn't stop a script, but this line is the **last command of the function**, so the function's result becomes that failure, and bash uses it as the script's exit code. The script had said "passed", then exited `1`.

The weekly drill in the runbook only ever drills **encrypted** copies, which is why it had worked by luck. CI drills a plain one, which is why CI caught it.

The proof ran the script's **real** clean-up code with Docker stubbed out: exit code 1 before, 0 after. The fix:

```bash
if [[ -n "$plain" ]]; then rm -f "$plain"; fi
```

> **The lesson:** `[[ test ]] && command` is fine in the middle of a script and a trap when it is the last line. Use `if`. (The same shape appears in `deploy.sh` and `backup.sh`; each was checked, and neither is at the end of a function or trap.)

---

## 4. A statement that didn't add up

The Stage 18 dashboard writes the month as a sum you can check with a pencil:

```
Brought forward + Received − Spent = In hand today
```

It took those four figures from **three different places**: account balances (which count every entry, including ones dated in the future), the net-worth chart's series (which counts archived accounts differently), and the daily cash-flow report (which stops at today). When the three disagreed, the page quietly filled the gap with a line called "Accounts added or adjusted". That line was invented money.

Two proofs, in a real browser:

| Scenario                                                  | Before                                       | After                     |
| --------------------------------------------------------- | -------------------------------------------- | ------------------------- |
| $1,000 balance, $50 coffee today, $1,500 rent on the 25th | "Net worth −$550", "adjusted −$1,500"        | **$950**, no extra line   |
| An archived account holding $5,000                        | "adjusted −$5,000", every month from then on | **$6,000**, no extra line |

The fix is a rule, not a patch: **all four figures come from one query**, `GET /v1/households/:id/reports/month-statement`, answered as of the household's own "today":

```
brought forward = opening balances + everything before the 1st of this month
received / spent = this month, up to and including today (transfers excluded)
net worth today  = opening balances + everything up to and including today
```

- Entries dated **after today** haven't happened yet, so they are in none of the four.
- **Archived** accounts count. They still hold money or debt, and the net-worth chart already counted them.
- A **transfer's** two halves sit in the same window, so they cancel out of the balances and are neither income nor spending.
- The server's test builds the awkward household on purpose (a loan, an archived account, a transfer, a bill dated tomorrow) and checks the exact figures. A browser test pins the user-visible bug.

The page's own claim is now a property the code guarantees, so the invented line was **deleted**. The label also changed: a loan or a credit card lowers the total, so "In hand" (which sounds like cash) was wrong. It says **Net worth today**.

> **The lesson:** if a screen shows a sum, compute the sum once, in one place. Two numbers that "should" agree will, sooner or later, be computed by two different rules, and a "fudge" line that hides the difference turns a visible bug into a silent one.

### 4.1 The same rule, everywhere

Fixing the statement exposed a second problem, confirmed with a test: with a $500 bill dated next week on a $1,000 account, the statement said **$1,000** while the account balance and the net-worth chart said **$500**, on the same dashboard. You chose the rule: **everything is "as of today"**. An entry dated after today hasn't happened, so it is in no balance, no total and no chart until its day comes.

One place decides "today" for a request: the household check that already runs on every request now carries `request.household.today`. One shared helper, `throughToday(range, today)`, cuts a date range at the end of today. It is applied to:

| What                               | Change                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| Account balances (list and detail) | counts entries dated on or before today                         |
| Net-worth chart                    | its current-month point is today's balance, not the month-end's |
| Cash flow, daily cash flow         | this month's income and spending stop at today                  |
| Spending by category               | stops at today                                                  |
| Budgets (spent, remaining, alerts) | a bill dated the 20th doesn't use the budget until the 20th     |
| Goals                              | the balance is today's                                          |

**What did not change:** the transactions list still shows entries dated in the future (you can see what is coming), and a filtered list's summary still describes the rows you filtered.

**A trap, and its fix.** Budget alerts are queued by a database trigger when a transaction changes. A bill entered on the 9th and dated the 20th changes nothing on the 20th, yet that is the day it starts to count, so the alert would have waited for the next unrelated edit. A new hourly job, `budgets.evaluate-due`, finds households holding an entry that was **recorded before its own date and is dated today** (in the household's time zone) and queues the same evaluation the trigger would have. It is safe to repeat: evaluations are keyed per household and month, and every alert is de-duplicated. The test walks the real story: the 10th (no alert), then the 20th with nobody editing anything (alert).

**Two things found on the way.**

- The goals query worked out each month's balance from the end of the _month_, ignoring where the range ended, so cutting the range alone would not have fixed it. The query itself now stops at the range's end.
- My first version of the alert test had a **time bomb**: it used fixed November 2026 dates, but the check depends on the entry having been recorded _before_ its date, by the real clock. After 20 November it would have failed for no reason. The dates are now computed from the real clock (the pretend "today" is always next month), so it cannot rot.

---

## 5. Links you couldn't see

Stage 18's new palette made the "Create one" link (shown when you have no budgets) dark navy on dark grey text. The accessibility checker (axe) reported it as a **serious** problem: the link had a contrast of 1.95:1 against the words around it, and the rule needs 3:1 **or** an underline. A person can't tell it is a link.

It had never been caught because the accessibility sweep always started from the same tidy household: an account, a transaction and a budget. That hid every "nothing here yet" screen, and the savings stamp (which needs income). The sweep now also checks:

- every page of a **brand-new** household (all eight pages, collecting every page's problems before it fails, so one bad page can't hide the rest);
- the dashboard with **income and no budgets**, which shows both the stamp and the link.

Both were red before the fix, in light and dark. The link is now underlined (`underline underline-offset-4`).

> **The lesson:** a test that only visits the happy path can't see the screens a new user sees first. Give every test suite a "starting from nothing" case.

---

## 6. Privacy and terms

The app stores people's money, and had no page saying so. Two public pages now exist, `/privacy` and `/terms`, linked from the sign-up form (with underlined links, per section 5).

How they were written matters more than what they say:

- **Only what the code does.** Each claim was checked against the code before it was written: that sign-in sessions store the IP address and browser (`sessions` table), that the sign-in cookie lasts up to 30 days and ends after 14 idle days, that the "known device" cookie lasts a year, that recovery codes are hashed, that there are no analytics or trackers, that fonts are served by the app, and that "Download my data" and "Delete my account" exist under Settings → Security.
- **No placeholder text in the code.** Who runs the service comes from two settings on the server, `LEGAL_OPERATOR_NAME` and `LEGAL_CONTACT_EMAIL`, read when the page is requested. If they aren't set, the page says nothing about contact rather than showing "[your name here]". The address is checked to look like an address, because it ends up inside a `mailto:` link.
- **The 14-day promise has to be true.** The privacy page says data from a deleted account leaves the backups "normally within 14 days". The local copies now follow that (section 7), and the runbook now tells you to give the off-site bucket the same 14-day lifecycle rule.

> **These pages describe the app; they are not legal advice.** If you take other people's financial data for real, have a lawyer read them.

---

## 7. The server's disk

The 8 alerts from Stage 14 all ask "is the **app** healthy?". None asked "is the **server** healthy?". And the runbook's schedule made a full disk more likely: hourly backups kept for 14 days is **336 dumps** on the same disk as the database. When a disk fills, Postgres stops, and everything breaks at once.

**An alert, and an alert for the alert.** A `node-exporter` container (in the monitoring profile) reports the server's disk space to Prometheus. Three rules, each with a promtool unit test (red before the rules existed):

| Alert                      | When                            | Severity |
| -------------------------- | ------------------------------- | -------- |
| `LedgerlyDiskFillingUp`    | under 20% free for 15 minutes   | warning  |
| `LedgerlyDiskAlmostFull`   | under 8% free for 5 minutes     | critical |
| `LedgerlyDiskNotMonitored` | node-exporter stopped reporting | warning  |

The third is the same idea as the backups' dead man's switch (Stage 16): if the watcher stops, the first two can never fire, so **silence must alert too**. node-exporter was run for real, with the same hardening as the rest of the stack (read-only, no capabilities), to confirm it reports exactly `node_filesystem_avail_bytes{mountpoint="/"}`, the series the rules use. The root is mounted `:ro` rather than the documentation's `rslave`, which can stop the container from starting on a host whose `/` isn't a shared mount (it did, in the test environment).

**Fewer copies.** `prune-backups.sh` keeps every backup for **2 days**, then only the first of each UTC day, and nothing past **14 days**. Its test builds a folder of backups of every age, runs it, and compares the survivors to an exact list. It was **mutation-tested**: with the thinning line removed, and with the "keep daily copies" rule broken, the test fails each time, so it can tell right from wrong.

---

## 8. Small things

- **`pnpm db:up` starts Mailpit too.** The README and the tests assumed it did; it started only Postgres, so a first run failed 2 tests and sign-up emails went nowhere.
- **One minus sign.** The statement's total read `-$550.00` (a hyphen, from the number formatter) under lines written `−$50.00` (a real minus sign). The animated total now uses the real minus, for what you see and for what a screen reader hears. A test fails without it.
- **The design style guide is not public in production.** `/design` answered 200 to anyone. It now answers 404 in production unless `SHOW_DESIGN_PAGE=true`, and the home page's link to it disappears with it. In development nothing changes.
- **The home page is a front door.** `/` was the learning project's status page: "all 15 stages complete", a roadmap of build stages, a "shared code check" and a live API status that printed the build version to anyone. It now says what Ledgerly is, lists what it really does (nothing it doesn't), has "Get started" and "Sign in", and links to Privacy and Terms. The browser test asserts what a visitor must see, and that "stage", "roadmap" and a version number appear nowhere; it was red against the old page ("all 15 stages complete"). The status component and its server call were dead code afterwards and were deleted. Its wording and look are a first version for you to change.

---

## 9. Found while fixing, and left for later

Honest notes, not excuses:

- **The first push of this stage failed CI, on my own new code.** `backup.sh` changes directory at its top, and the new call to `prune-backups.sh` found it through a path that was only valid _before_ that. It broke when CI ran the script from the repo root (`deploy/scripts/backup.sh`) and would have worked by luck from the runbook's cron line. My local check had run the pipeline outside `backup.sh`, so it missed this; CI's real "Back up, then prove the backup restores" step caught it. The fix resolves the script's own folder to an absolute path first, and was reproduced using `backup.sh`'s real header lines before it was fixed. The second CI run passed. **The lesson: test an integration through the real entry point, not a lookalike.**
- **Three different "net worths" when a bill is dated in the future** was confirmed with a test and then **fixed**: see [section 4.1](#41-the-same-rule-everywhere).
- **A stale test server fooled a browser check.** Next.js renames its own process to `next-server`, so `pkill -f server.js` never stopped it, and a pre-rebuild copy kept serving pages whose script files were gone. If a browser check shows "This page couldn't load", look for an old server first.
- **One timing test failed once under load, and was not reproduced.** `worker.test.ts › wakes on NOTIFY instead of waiting for the next poll` gives the worker 2 seconds to wake up. It failed ("not done within 2000 ms") in one full API run while other work was running, then passed 4 of 4 times on its own and in 3 further full runs. These changes don't touch the worker, so it is not believed to be caused by them, but "not reproduced" is not "fixed": if CI shows it, a looser budget (or retry) is the likely cure.
- **Only `restore-drill.sh` had the exit-code bug**, and CI's real drill step is what guards it; no separate test was added for it.

---

## 10. Results

| What                                        | Before                                           | After                                                |
| ------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| CI on `main`                                | red (restore drill exits 1 after "passed")       | drill exits 0                                        |
| Bill dated tomorrow, shown on the dashboard | Net worth −$550, "adjusted −$1,500"              | $950, no extra line                                  |
| Archived $5,000 account                     | "adjusted −$5,000" forever                       | counted, no extra line                               |
| Link on the no-budgets dashboard            | contrast 1.95:1, serious                         | underlined, 0 violations in light and dark           |
| Privacy and terms                           | none                                             | two public pages, linked from sign-up                |
| Disk-space alerts                           | none                                             | 3, with unit tests                                   |
| Local backups                               | 336 dumps at 14 days of hourly copies            | every copy 2 days, then one per day to day 14        |
| `/design` in production                     | 200 for anyone                                   | 404                                                  |
| `pnpm db:up`                                | Postgres only (2 tests failed on a fresh run)    | Postgres and the mail inbox                          |
| Total minus sign                            | `-$550.00`                                       | `−$550.00`                                           |
| Home page                                   | a build-progress page, with the API's version    | what it is and how to start; nothing about the build |
| A bill dated next week                      | statement $1,000, accounts and chart $500        | all say $1,000 (as of today)                         |
| Tests                                       | 492 (db 35, api 222, shared 89, web 117, e2e 29) | **524** (db 35, api 228, shared 93, web 128, e2e 40) |

---

## 11. Run it yourself

```bash
pnpm db:up && pnpm db:migrate
pnpm turbo run lint typecheck test:coverage build
pnpm db:generate        # must say "No schema changes"
pnpm e2e
```

The shell and alert checks, which need Docker:

```bash
deploy/scripts/prune-backups.test.sh
docker run --rm -v "$PWD/deploy/prometheus:/p" --entrypoint promtool prom/prometheus:v3.15.1 test rules /p/alerts.test.yml
```

To see the statement fix yourself: sign up, add an account, record an expense dated **tomorrow**, and open the dashboard. Today's figures don't move.

---

## 12. What only you can do

None of this can be done from the code. The runbook's _Setting up a server_ has the steps; the short list:

- **GitHub:** protect `main` (require a pull request and the four CI checks); create the `production` environment with yourself as required reviewer and only `main` allowed; require approval for outside collaborators' pull requests; add the four deploy secrets and the `SITE_ADDRESS` variable; then set `DEPLOY_ENABLED=true`.
- **Server:** Docker, a `deploy` user, DNS, a firewall, and `deploy/.env`. Save `ENCRYPTION_KEY` and `POSTGRES_PASSWORD` in your password manager.
- **Backups:** generate the `age` key on your own machine and keep the private half in your password manager; create the off-site bucket **with a 14-day lifecycle rule** (the privacy page promises it); create the two check-in URLs; install the cron entries.
- **Alerts:** your SMTP details in `alertmanager.yml`, then start `prometheus alertmanager node-exporter` and run the stop-the-worker test. Add the outside uptime check (step 11).
- **Email:** verify your sending domain (SPF, DKIM, DMARC).
- **Legal:** set `LEGAL_OPERATOR_NAME` and `LEGAL_CONTACT_EMAIL` in `deploy/.env`, read both pages, and have a lawyer read them if real people's money data is involved.
- **Read the new home page** (`/`) and change its words or look to taste. It is a deliberately plain first version.
