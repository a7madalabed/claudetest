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
8. [Three small things](#8-three-small-things)
9. [Found while fixing, and left for later](#9-found-while-fixing-and-left-for-later)
10. [Results](#10-results)
11. [Run it yourself](#11-run-it-yourself)
12. [What only you can do](#12-what-only-you-can-do)

---

## 1. What we built

| Area       | Change                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| CI         | The restore drill exits `0` when it passes, so CI can go green again and deploys can run                                     |
| Dashboard  | The month statement's four figures come from **one** server calculation; the invented "adjusted" line is gone                |
| Dashboard  | "In hand today" is now "Net worth today" (a loan or card lowers it, so it isn't cash in hand)                                |
| Links      | "Create one" is underlined; the accessibility sweep now visits the empty and first-run states it used to skip                |
| Legal      | Public **Privacy** and **Terms** pages, linked from sign-up; the operator's name and contact come from the server's settings |
| Operations | A disk-space alert (two levels, plus one for the watcher going quiet); local backups thinned to one per day after two days   |
| Small      | `pnpm db:up` also starts the mail inbox; one minus sign everywhere; the design style guide is not public in production       |

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

## 8. Three small things

- **`pnpm db:up` starts Mailpit too.** The README and the tests assumed it did; it started only Postgres, so a first run failed 2 tests and sign-up emails went nowhere.
- **One minus sign.** The statement's total read `-$550.00` (a hyphen, from the number formatter) under lines written `−$50.00` (a real minus sign). The animated total now uses the real minus, for what you see and for what a screen reader hears. A test fails without it.
- **The design style guide is not public in production.** `/design` answered 200 to anyone. It now answers 404 in production unless `SHOW_DESIGN_PAGE=true`, and the home page's link to it disappears with it. In development nothing changes.

---

## 9. Found while fixing, and left for later

Honest notes, not excuses:

- **The public home page (`/`) is still the learning project's status page.** It says "Built in fifteen stages", counts stages (stuck at 15), shows a "Shared code check" line and a live API status (including the build version). It is not a front door for a product. This is a product and design decision, so it was **not** changed here. It is the first thing a visitor sees.
- **Account balances count entries dated in the future.** The Accounts page (and the old dashboard) include a bill dated next week in today's balance. That is a legitimate choice for a "projected" balance, but it differs from the month statement, which now says "as of today". Worth deciding on purpose.
- **The net-worth chart's last point** includes the whole current month (from reading the code, not tested), so it can differ from "Net worth today" when future-dated entries exist.
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
| Tests                                       | 492 (db 35, api 222, shared 89, web 117, e2e 29) | **514** (db 35, api 224, shared 89, web 128, e2e 38) |

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
- **Decide:** what the public home page should be.
