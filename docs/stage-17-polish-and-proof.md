# Stage 17 — Polish and Proof

> **Goal of this stage:** finish the pre-launch review's list: three race conditions, three different ideas of what "today" means, a missing screen, two stacks that stepped on each other, and the one request that failed in every deploy. Then make the most important claim, "a deploy fails no requests", something CI **checks** instead of something we once measured.
>
> **What you'll learn:** how to test a race condition deterministically instead of hoping to catch it; why a shared household needs one calendar; why renaming a Docker Compose project can silently give you an empty database; and how a fix that looked obviously right made things worse, and how measuring caught it.

---

## Table of contents

1. [What we built](#1-what-we-built)
2. [Three races](#2-three-races)
3. [One clock](#3-one-clock)
4. [A Categories page](#4-a-categories-page)
5. [Two stacks, one name](#5-two-stacks-one-name)
6. [The one request each deploy failed](#6-the-one-request-each-deploy-failed)
7. [Results](#7-results)
8. [Run it yourself](#8-run-it-yourself)

---

## 1. What we built

| Area       | Change                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| Budgets    | A category and its parent can't both get a budget, even when both are created at the same moment            |
| Retries    | Identical retries with a client-chosen id get the saved reply, never `409`                                  |
| Jobs       | A worker whose job was taken over by another worker is told to stop                                         |
| Dates      | "Today" and "this month" are the household's, on the server and in the browser                              |
| Categories | Settings → Categories: add, rename, archive, delete                                                         |
| Compose    | Production is the project `ledgerly-prod`, with volume and network names pinned                             |
| Deploys    | The draining API answers what's already arriving instead of `503`; CI fails any deploy that drops a request |

---

## 2. Three races

A **race condition** is a bug that only shows when two things happen at nearly the same moment. They're the hardest bugs to test, because a test that "usually" catches them is worse than useless: it passes on the day you need it to fail. So every test below was checked to be **red before the fix**, every time.

### 2.1 Budgets: "check, then insert"

A budget on "Food" already includes "Groceries", so the API refuses a budget on both. It checked by reading ("does an overlapping budget exist?") and then inserting. Two requests arriving together both read "no", both inserted, and Groceries' spending counted twice.

No unique index can express "not this category AND its parent", so `createBudget` now **locks the household's row** first, inside the transaction that checks and inserts. Budget creations in one household take turns. It uses `FOR NO KEY UPDATE`, the weakest lock that does the job, so ordinary writes that merely _reference_ the household (a new transaction, say) aren't held up.

**The test doesn't rely on luck.** Firing two requests at once "usually" interleaves the way we want, and the first version of this test passed even without the fix. The real test holds a first request **open half-way**, as a transaction of its own that has inserted the parent's budget but hasn't committed, then sends the child's request. Without the lock, the second request sails through (201). With it, it waits, then sees the parent's budget (422). Same result every run.

### 2.2 Retries that collided on the wrong key

The web app sends its own id with a new transaction (so the row appears instantly) **and** an `Idempotency-Key` (so a retry can't create a duplicate). Two copies of the same request racing each other used to collide on the **transaction's** id before the key's, and the loser answered `409 transaction_exists` instead of the saved reply.

The fix is one rule in `lib/idempotency.ts`: when a request with a key fails for **any** reason, check whether an identical request with that key has meanwhile succeeded, and if so, return its stored answer. Ten parallel copies: ten `201`s and one row (before: several `409`s, every run).

### 2.3 A job that two workers ran at once

A worker keeps a **lease** on its job and renews it every few seconds. If the renewals stall (a long pause, a network blip), the lease expires and another worker takes the job over. That's how crashes are survived. But the first worker never noticed: it ignored the result of its renewal, so both kept running the same job.

Renewal now reports whether the job is still ours. If not, the handler gets the same "please stop" signal as during a shutdown, and the new owner's claim is left alone.

---

## 3. One clock

"What month is it?" had three answers:

- the **browser's** clock: the Budgets page and the dashboard;
- the **household's** time zone: budget alerts and recurring transactions;
- **UTC**: goals, a budget edit's default month, the recurring-bills report, and the response cache's key.

So two members in different time zones, the server's alerts and the Budgets page could each be in a different month. And a household at UTC+14 was served **yesterday's cached answers for 14 hours** after its own midnight, because the cache started each new day at UTC's midnight.

**The rule now: periods belong to the household.** Budgets, reports, alerts and goals use the household's time zone everywhere:

- **Server:** the household check (the one that runs on every household request) now also carries the time zone. Goals, budgets, reports and the cache use `todayIn(timeZone)`. The cache key includes the zone too, so changing it can't serve answers computed for the old one.
- **Browser:** `householdNow(timeZone)` returns the household's wall clock as a `Date` whose day and month read correctly, so the existing date helpers work unchanged. The client no longer sends `?today=` at all: the server decides.

**But what _you_ did follows your clock.** A new transaction's default date, and "Today" / "Yesterday" in the list, are about the person: if you buy coffee on a trip, it happened on your date.

The test fakes the clock to 23:30 and then 00:30 at UTC+14, both on the same UTC day, and checks that the cache treats them as different days. It returned `304 Not Modified` before the fix.

---

## 4. A Categories page

New households get starter categories (Stage 16), but changing them still needed the API. **Settings → Categories** shows spending and income as two trees, subcategories indented under their parent and sharing its icon. You can:

- **add** a category, optionally inside a top-level one (the API allows one level, of the same kind);
- **rename** it (every transaction keeps it);
- **archive** it (hidden from new transactions, history untouched) and bring it back;
- **delete** it, if nothing uses it. Otherwise the API refuses and says to archive instead.

A duplicate name at one level appears next to the name field. The page is in the light/dark accessibility sweep, with a browser test of the whole journey.

---

## 5. Two stacks, one name

The development stack (`docker-compose.yml`) and the production stack (`deploy/compose.yaml`) were **both** named `ledgerly`. To Docker, two Compose files with one project name are **one project**. Following the README's "try production on your machine" while `pnpm db:up` was running **replaced the development Postgres container**. A dry run showed it: `Container ledgerly-postgres-1 Recreate`.

Production is now `ledgerly-prod`. But renaming a project is a trap: Docker names volumes `<project>_<volume>`, so after a rename it looks for `ledgerly-prod_pgdata`, finds nothing, and creates a **new, empty database**. No error, just no data. So the volume and network names are pinned to the names they always had (`ledgerly_pgdata`, `ledgerly_backend`…). Data, certificates and the runbook's commands are untouched. A server set up before this change needs one step (in the runbook): stop the old project's containers, which keeps every volume.

> **The lesson:** Docker derives names from other names. Before renaming anything in a Compose file, ask what's _derived_ from it.

---

## 6. The one request each deploy failed

Stage 14 measured **0** failed requests during a deploy. The pre-launch review measured **1**: 1 in 9,253 and 1 in 10,569. It happened at the instant the old API finished draining and closed, and it was always Fastify's own 80-byte reply, `{"error":"Service Unavailable",…}`.

### 6.1 Reproduce it on purpose

A failure that happens once in ten thousand requests, sometimes, is hopeless to chase by running deploys. We ran six more deploys of the old code under heavier load and saw **zero** failures. That body is a clue, though: Fastify sends it to a request that **finished arriving after closing began**, on a connection that was already open (its `return503OnClosing` option, on by default). So `src/shutdown.test.ts` does exactly that, every time:

1. start the real server process (`src/server.ts`);
2. open a connection and send **half** a request;
3. send `SIGTERM`, as `docker stop` does;
4. wait for the drain to end, then send the rest of the request.

Old code: `503 Service Unavailable`, the same 80 bytes. Fixed: `200 OK`.

### 6.2 The fix

`return503OnClosing: false`. Closing still refuses **new** connections, so nothing new is accepted, but whatever is already arriving gets answered.

### 6.3 The fix that made it worse

Our first version also **closed idle connections** at the start of the drain, to push the web server onto fresh ones. It looked obviously right. The second deploy under load failed a request: a **500** on a server-rendered page, at exactly the moment the drain began. The web server had sent a request on an idle connection at the same instant the API closed it.

The old code never had that problem, and the reason is worth knowing. HTTP clients close their own idle connections a little **before** the server's keep-alive timeout (5 s), precisely to avoid this race, and the drain lasts 5 s. By the time the API closes, the clients have already let go. So the server-side close was removed, and `server.ts` explains why it isn't there.

> **The lesson:** a fix is a hypothesis until it's measured. This one would have shipped a new failure in place of the old one.

### 6.4 Results, and keeping them

With the final fix: **6 rolling deploys under signed-in load through Caddy, 0 failed of 38,869 requests**.

And it stays that way: CI's rolling-deploy step now runs under `tools/perf/scripts/deploy-under-load.mjs`, which signs in, keeps requesting API calls, a server-rendered page and a static page through Caddy for the whole deploy, and **fails the job on any 5xx or unanswered request**. A claim in a document can go stale without anyone noticing; a check in CI can't.

---

## 7. Results

| What                                          | Before                    | After                                                |
| --------------------------------------------- | ------------------------- | ---------------------------------------------------- |
| Budget on a category + its parent, at once    | both created              | second refused (422)                                 |
| 10 identical retries with a client id         | several `409`s            | 10 × `201`, one row                                  |
| Worker whose job was taken over               | keeps running it          | told to stop                                         |
| Cached answers after midnight at UTC+14       | yesterday's, for 14 h     | today's                                              |
| Change categories in the app                  | no                        | Settings → Categories                                |
| "Try production locally" next to `pnpm db:up` | replaced the dev database | separate project, same data                          |
| Request completing while the API closes       | `503`                     | `200`                                                |
| Failed requests during deploys                | 1 per deploy (2 of 2)     | 0 of 38,869 over 6 deploys; checked in CI            |
| Tests                                         | 471                       | **482** (db 35, api 222, shared 89, web 107, e2e 29) |

---

## 8. Run it yourself

```bash
pnpm db:up && pnpm db:migrate
pnpm turbo run lint typecheck test:coverage build
pnpm e2e
```

To watch the shutdown fix work, run just its test, then try it without the fix:

```bash
pnpm --filter @ledgerly/api exec vitest run src/shutdown.test.ts
# now set return503OnClosing: true in apps/api/src/app.ts and run it again: 503
```

And to check a deploy yourself, build the images, deploy one version (README, _Running it in production_), then run the load check during a second deploy:

```bash
node tools/perf/scripts/deploy-under-load.mjs https://localhost /tmp/stop &
SKIP_PULL=1 deploy/scripts/deploy.sh <second-tag>; touch /tmp/stop; wait
```

(Set `RATE_LIMIT_ENABLED=false` in `deploy/.env` first, as all the traffic comes from your one address, and `NODE_EXTRA_CA_CERTS` to Caddy's root certificate.)
