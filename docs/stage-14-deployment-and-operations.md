# Stage 14 — Deployment & Operations

> **Goal of this stage:** take Ledgerly from "runs on my laptop" to "runs in production": built once into container images, deployed without downtime, watched by metrics and alerts, and protected by backups that are _proven_ to restore.
>
> **What you'll learn:** build-once/run-anywhere configuration; multi-stage container images for a monorepo; a hardened production stack; migrations that are safe while the app is running; rolling deploys with draining and automatic rollback, measured under load; structured logs, Prometheus metrics and tested alert rules; consistent backups and restore drills; and a deployment pipeline with supply-chain safeguards. Above all: **every one of these was tested by breaking it on purpose**, and five real problems turned up that no earlier stage could have found.

---

## Table of contents

1. [What we built](#1-what-we-built)
2. [The shape of production](#2-the-shape-of-production)
3. [Build once, run anywhere](#3-build-once-run-anywhere)
4. [Container images](#4-container-images)
5. [The production stack](#5-the-production-stack)
6. [Migrations in a running system](#6-migrations-in-a-running-system)
7. [Deploying without downtime](#7-deploying-without-downtime)
8. [Observability: logs, metrics, alerts](#8-observability-logs-metrics-alerts)
9. [Backups you have actually restored](#9-backups-you-have-actually-restored)
10. [The pipeline](#10-the-pipeline)
11. [Results](#11-results)
12. [What testing caught this stage](#12-what-testing-caught-this-stage)
13. [Run it yourself](#13-run-it-yourself)
14. [Exercises](#14-exercises)
15. [Glossary](#15-glossary)
16. [The whole journey, and where to go next](#16-the-whole-journey-and-where-to-go-next)

---

## 1. What we built

| Area          | What's new                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration | The `/api` proxy moved from build time (`next.config.ts`) to request time (`proxy.ts`): **one web build runs in every environment**. Standalone Next.js output.                                 |
| Images        | `apps/api/Dockerfile` (API, worker and migrator: one image, three commands) and `apps/web/Dockerfile`. Multi-stage, pruned, production dependencies only, non-root, pinned base, health checks. |
| Stack         | `deploy/compose.yaml`: Caddy (automatic HTTPS), web, API, worker, Postgres, one-off migrator, optional Prometheus. Read-only containers, no capabilities, least-privilege secrets.              |
| Migrations    | A separate `migrate` step before every rollout; a **lock timeout** so a migration can't freeze the app; tested.                                                                                 |
| Deploys       | `deploy/scripts/deploy.sh`: rolling updates with **draining**, a smoke test through HTTPS, **automatic rollback**. Measured: 0 failed user requests out of 6,436 during a deploy.               |
| Observability | JSON logs with service, build and validated request IDs; Prometheus metrics (HTTP, database pool, jobs, queue age); **8 alert rules with unit tests**; Prometheus in the stack.                 |
| Backups       | `backup.sh` (consistent snapshot, checksum, exact row counts, off-site upload hook) and `restore-drill.sh` (restore, verify every count, boot the app on the copy).                             |
| Pipeline      | CI builds the images and runs the real deploy, backup and drill on every change. `deploy.yml` publishes signed images and deploys after CI passes: **off until you opt in**.                    |
| Operations    | [`docs/runbook.md`](./runbook.md): server setup, deploy, rollback, restore, and a section for every alert.                                                                                      |

---

## 2. The shape of production

```
                 ┌────────────────────────── one server, Docker Compose ──────────────────────────┐
  browser ──443──► Caddy ──► web (Next.js) ──/api──► api (Fastify) ──► Postgres ◄── worker (jobs)  │
  (HTTPS)        │ TLS, HSTS, compression      │                       ▲                          │
                 │                              └─ server components ───┘          migrate (one-off)│
                 │                                                                                 │
                 │ Prometheus ──scrapes :9464──► api, worker              (private network only)   │
                 └─────────────────────────────────────────────────────────────────────────────────┘
```

Only Caddy is reachable from the internet. Everything else talks on a private Docker network.

Why one server with Compose, and not Kubernetes or a platform like Fly.io or Render? Stage 12 measured that one modest server carries thousands of households. A single host is the simplest thing that works, and **simple is a feature in operations**: fewer moving parts, fewer ways to fail at 3 a.m. Everything here moves to a bigger platform unchanged. The images, health checks, graceful shutdown, migrations job and metrics are exactly what Kubernetes or a managed container service expects. Section 16 lists what changes when you outgrow one server.

---

## 3. Build once, run anywhere

The single most important rule of deployment: **the artifact you tested is the artifact you run**. Build one image per commit, then promote that same image through environments, changing only its **configuration**. That is "config in the environment", factor III of the classic twelve-factor app.

Stage 13 had already found where Ledgerly broke this rule. Next.js resolves `rewrites()` at **build time** and writes the target into the build output, so our `/api → API` proxy was frozen into every build. Stage 13 worked around it with a second build for the tests. That is a warning sign: every environment would have needed its own build.

The fix moves the proxy into `proxy.ts`. Next 16 runs it on the Node.js runtime on every request, so it reads `API_URL` at runtime:

```ts
// apps/web/src/proxy.ts
if (pathname.startsWith("/api/")) {
  return NextResponse.rewrite(new URL(`${pathname.slice("/api".length)}${search}`, apiUrl()));
}
```

```ts
// apps/web/src/lib/api-url.ts — read at REQUEST time, never at build time
export const apiUrl = () => process.env.API_URL ?? "http://localhost:4000";
```

Then we checked the three things a proxy must not break:

- **The build is clean:** the routes manifest now has no rewrites.
- **Live updates still stream:** all 14 browser journeys pass, including the two that depend on Server-Sent Events going through the proxy.
- **The client's address survives:** a request sent with `X-Forwarded-For: 203.0.113.9`, through the web server to an API trusting two proxy hops, was logged as `"ip":"203.0.113.9"`. Next appends each hop to the header.

Stage 13's separate test build is gone. The browser suite now runs the same standalone server the image runs, with `API_URL` set at runtime.

**Standalone output** (`output: "standalone"`) is the other half. `next build` traces exactly which files the server needs and copies them, with a minimal `node_modules`, into `.next/standalone`: 64 MB instead of the whole monorepo. A small script copies the static assets next to it, so one `node server.js` serves everything.

---

## 4. Container images

A container image is a sealed, versioned package of your app **and everything it needs to run**: the runtime, the libraries, the files. It runs the same on a laptop, in CI and on a server. Both of ours use a **multi-stage build**:

```dockerfile
# apps/api/Dockerfile (abridged)
ARG NODE_IMAGE=node:22.23.4-alpine3.24          # pinned: upgrades are deliberate

FROM ${NODE_IMAGE} AS prune                       # 1. just this app + its packages
COPY . .
RUN npx --yes turbo@2.11.10 prune @ledgerly/api --docker

FROM ${NODE_IMAGE} AS build                       # 2. install, then build
RUN corepack enable
COPY --from=prune /repo/out/json/ ./              #    manifests FIRST…
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile                #    …so this slow layer is reused until a dependency changes
COPY --from=prune /repo/out/full/ ./
RUN pnpm turbo run build --filter=@ledgerly/api
RUN pnpm --filter @ledgerly/api deploy --prod --legacy /out/api   # production deps only

FROM ${NODE_IMAGE} AS runtime                     # 3. only what runs
COPY --from=build /out/api/node_modules ./node_modules
COPY --from=build /out/api/dist ./dist
USER node                                         # never root
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:4000/health')…"
CMD ["node", "dist/server.js"]
```

The decisions:

- **`turbo prune`** solves the monorepo problem. It writes out only the packages the app depends on, plus a lockfile pruned to match. Copying the manifests before the source is what makes layer caching work: edit a component and Docker reuses the install layer.
- **`pnpm deploy --prod`** produces a self-contained folder with production dependencies only. We checked inside the image: 70 MB of `node_modules`, and no TypeScript, Vitest, ESLint or tsx.
- **Three stages, one survivor.** Compilers, caches and source code stay in the build stages. The final image holds the runtime, the dependencies and the compiled output.
- **One API image, three commands:** `dist/server.js`, `dist/worker.js` and `dist/migrate.js`. The API, the worker and the migrator can never run different versions of the same code.
- **Non-root, owned by root.** The process runs as `node` but can't modify its own files. In the stack the whole filesystem is read-only too (§5).
- **`APP_VERSION`** is baked in at build time: the git commit. It appears in `/health`, in every log line and in a metric. "Which version is running?" becomes something you look up, not something you guess.
- **Liveness health checks only.** The web image checks `/healthz`, a route that deliberately **does not call the API**. If it did, an API outage would mark every healthy web container as dead and the platform would restart them all, turning one failure into two.

Final sizes: API 324 MB, web 329 MB. About 160 MB of each is the Node.js Alpine base, which Docker stores once and shares between them.

> **How this was verified.** Every image in this document was really built and run, and the stack really deployed and broken. The sandbox used to write this course rate-limits Docker Hub and intercepts TLS, so base images came from public mirrors (`mirror.gcr.io`) and were given a local copy of the sandbox's certificate authority under their official names. The committed Dockerfiles are completely standard, and CI on GitHub uses the real images.

---

## 5. The production stack

`deploy/compose.yaml` describes the whole system. The parts worth understanding:

**Every application container is locked down:**

```yaml
x-app: &app
  read_only: true # the code can't be modified at runtime, even by an attacker
  tmpfs: [/tmp]
  cap_drop: [ALL] # no Linux capabilities at all
  security_opt: ["no-new-privileges:true"]
  logging: { driver: json-file, options: { max-size: "10m", max-file: "5" } } # logs can't fill the disk
```

We checked it: `touch /app/x` inside the API container fails with "Read-only file system", and `id` says `node`.

**Least privilege for secrets.** The API, worker and migrator get the database URL and the encryption key. The web server gets **neither**: it only needs `API_URL`. Required values use `${VAR:?message}`, so a missing secret stops `compose` with a clear message instead of starting a broken container.

**Startup order is real dependency order:**

```yaml
migrate: { depends_on: { postgres: { condition: service_healthy } } }
api: { depends_on: { migrate: { condition: service_completed_successfully } } }
web: { depends_on: { api: { condition: service_healthy } } }
```

A failed migration stops everything after it. On an empty server, `docker compose up --wait` brought the whole stack up in **19 seconds**.

**Caddy** is the front door. Given a domain, it gets and renews a Let's Encrypt certificate by itself; given `localhost`, it uses an internal one. It adds HSTS, strips the `Server` header and compresses responses. It also sets `X-Forwarded-For` to the real client address **and ignores any value a client sends**, so the address can't be forged. Behind it, the API trusts exactly two proxy hops (Caddy, then the web server). We confirmed redirects point at the public HTTPS address (`/app` → `https://localhost/app/<id>`), not at an internal one.

---

## 6. Migrations in a running system

**A separate step, not "migrate on boot."** Three API instances starting at once means three migrators racing. And a slow migration delays every instance's start and its health checks. So `deploy.sh` runs `node dist/migrate.js` once, _before_ the rollout; it exits 0 on success and 1 on failure. If it fails, the deploy stops and the old version keeps serving.

**Concurrent migrators are safe:** Stage 3 already took a Postgres advisory lock around migrations. A new test runs two migrators at the same moment on an empty database; both succeed.

**The lock timeout** is new, and it prevents a classic outage. `ALTER TABLE` needs an exclusive lock on the table. If a long query is running, the `ALTER` waits, and **every new query on that table queues behind the waiting `ALTER`**. A migration stuck for a minute takes the app down for a minute. So the migrator now waits patiently for _another migrator_, but only 10 seconds for application traffic:

```ts
await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]); // other migrators: wait
await client.query(`set lock_timeout = ${Math.round(lockTimeoutMs)}`); // app traffic: give up
```

The test holds a lock on a table in one connection and runs a migration that needs it. The migration fails within the timeout ("canceling statement due to lock timeout"), then succeeds once the lock is released. Mutation check: with the `set lock_timeout` line deleted, the migration hangs until the test times out. That is exactly the outage.

**Expand/contract.** During every rolling deploy, old and new code run side by side, and a rollback runs old code against the new schema. So every migration must keep working with the previous release. Renames, drops and new `NOT NULL` columns are split across two releases. The [runbook](./runbook.md#migrations) has the table. Ledgerly's 13 existing migrations all happen to be additive, but the rule is now written down where the next migration's author will see it.

---

## 7. Deploying without downtime

`docker compose up` replaces a container by stopping the old one, then starting the new one, so every request in between fails. `deploy.sh` does a **rolling update** instead, service by service:

1. Start a new container **next to** the old one (`--scale api=2 --no-recreate`).
2. Wait until the new one's health check passes. If it never does, remove it, keep the old one, and **roll everything back**.
3. Stop the old one with `SIGTERM`, which makes it **drain**:
   - the API answers readiness checks with 503, so load balancers move traffic away;
   - it adds `Connection: close` to every response, so clients reconnect elsewhere;
   - it finishes in-flight requests, then exits.
4. After all three services, run a **smoke test** through the public entrance. If it fails, roll back.

The smoke test checks three things through HTTPS: the web server reports the _new_ version, the system is ready, and the login page renders.

### 7.1 The experiment

A deploy script is only as good as its behaviour under traffic. So we ran three loops of signed-in requests through Caddy (API calls, server-rendered pages, the login page) during each deploy, recording every response.

**Run 1** went badly, in an instructive way:

| Result             | Count | What it meant                                                         |
| ------------------ | ----- | --------------------------------------------------------------------- |
| `429` on API calls | 3,465 | Rate limiting doing its job: all the load came from one IP. Expected. |
| `500` on `/app`    | 1,132 | **A real production bug** (below)                                     |
| Old web container  | 30 s  | Didn't stop until Docker killed it                                    |
| Smoke test         | ✘     | Failed → **automatic rollback** to the previous version, which worked |

**Bug 1: everyone shared one rate-limit bucket.** Server-rendered pages call the API from the web server, and those calls didn't pass on the visitor's address. To the API, every user's server-side requests came from one IP: the web container's. All users shared a single 300-requests-a-minute allowance, so the busier the site, the more everyone would hit errors. The fix forwards the `X-Forwarded-For` header that Caddy set. Afterwards, the API log shows server-rendered calls with the client's address (`172.18.0.1`), not the web container's (`172.18.0.7`).

**Bug 2: a busy proxy kept the old server alive.** Next's shutdown handler is correct: stop accepting connections, finish open requests, exit. But Caddy kept reusing its **kept-alive** connections to the old container. Under steady traffic they never went idle, so the old server never finished. Worse, it kept serving the _old_ version, which is why the smoke test failed. The fix has three parts:

- Caddy finds web containers through Docker's DNS every second (`dynamic a web 3000`).
- Caddy opens a **fresh connection per request** (`keepalive off`). On a local network that costs well under a millisecond.
- Caddy retries _refused_ connections on another container (`lb_try_duration 5s`). The Caddy docs promise such retries are always safe, because the request never reached a server.

A draining web server refuses new connections, so traffic moves to the new container at once. A 10-second cap (`instrumentation.ts`) ends shutdowns that are held open by live-update streams; browsers reconnect by themselves.

We first planned to use Caddy's _active_ health checks for this. The docs say, in so many words, that "active health checks do not run for dynamic upstreams". Checking before building saved a design that would never have worked.

**Run 2**, after the fixes, with the rate limiter off to isolate the deploy:

| Responses during the deploy  | Count     |
| ---------------------------- | --------- |
| 200 / 307 (redirects)        | **6,436** |
| Failed user requests         | **0**     |
| 503 from `/api/health/ready` | 60        |

The old web server now stops in about a second. The 60 `503`s are the draining API **truthfully** answering "I'm going away" to readiness probes, which is the design. Users never call that endpoint. External uptime monitors shouldn't either: the runbook points them at `/healthz`.

**Run 3** deployed a deliberately broken release: a web image that starts but never answers. The new container never became healthy, so the old one was never touched. The script then rolled the API and worker back too, smoke-tested, and exited 1. During all of that, **0 of 5,805 user requests failed**.

### 7.2 The honest limits

- That broken release _refused_ connections, so Caddy routed around it. A release that **answers with errors** would receive a share of traffic while `deploy.sh` waits for its health check: Docker's DNS lists a container as soon as it starts, not when it's healthy. Routing only to _ready_ instances needs a load balancer that health-checks each instance (any cloud load balancer, or Kubernetes readiness). The smoke test and automatic rollback limit the damage to tens of seconds.
- One server is one point of failure: if it dies, the site is down until it's replaced. Section 16 covers the next step.

---

## 8. Observability: logs, metrics, alerts

Observability answers "what is the system doing, and is it OK?" without logging in to look. It has three pillars:

- **logs**: what happened, event by event;
- **metrics**: how much and how fast, over time;
- **traces**: where the time went in one request.

We built the first two properly and left tracing for later (§16). With two services and request IDs that already connect their logs, tracing adds the least right now.

### 8.1 Logs

The API and worker already wrote JSON logs (Stage 4). Three changes make them useful in production:

- **Every line carries `service` and `version`.** "Did the errors start with the new release?" becomes a filter. This also fixed a bug: the version came from `npm_package_version`, which is only set when a process starts via `pnpm`. In a container the API had always said `0.1.0`.
- **Request IDs are validated.** An upstream proxy may pass its own `X-Request-Id` to correlate logs across hops. But until now _anyone_ could, and the value went straight into our logs. Now it's accepted only if it looks like an ID; anything else is replaced. A test sends `evil\nFAKE LOG LINE` and checks it never appears.
- **Logs can't fill the disk:** Docker rotates them at 10 MB × 5 files per container.

### 8.2 Metrics

Prometheus **scrapes**: every 15 seconds it fetches `/metrics` from each process and stores the numbers as time series. We expose them on a separate, private port (9464), never on the public API. They describe our internals, and a scraper must not need a login or count against rate limits.

| Metric                                             | Why it's there                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ledgerly_http_request_duration_seconds`           | The **RED** signals (Rate, Errors, Duration) per route template, method and status |
| `ledgerly_db_pool_waiting`                         | Requests waiting for a database connection: an early sign of trouble               |
| `ledgerly_jobs_total`, `…_job_duration_seconds`    | What the worker did, how it ended, how long it took                                |
| `ledgerly_jobs_oldest_ready_age_seconds`           | How long the oldest due job has waited: the best single health signal of a queue   |
| `ledgerly_realtime_connections`, cache hits/misses | Live streams; response-cache efficiency (Stage 12)                                 |
| `ledgerly_build_info{version}`                     | Which build is running                                                             |
| CPU, memory, event-loop lag, GC                    | Built in (`collectDefaultMetrics`)                                                 |

Three lessons hide in that table:

- **Labels must have few possible values ("cardinality").** The route label is the _template_, `/v1/households/:householdId/accounts`. A raw URL would create a new time series per household, without limit, until the metrics system falls over. A test makes requests with a real household ID and asserts the ID never appears in the metrics output.
- **Never name a label `job`.** We did at first, for the job's name. Prometheus reserves `job` for the scrape target ("worker") and silently renames a clashing label to `exported_job`. The failed-jobs alert would have grouped by the wrong thing. It's now `job_name`, and writing the alert rules is what exposed it.
- **Put the version in an _info_ metric, not on every series.** A `version` label on every series would start a whole new set of series at each deploy. One `ledgerly_build_info` series with value 1 says the same thing at a fraction of the cost.

### 8.3 Alerts

An alert should mean: **a person needs to act**. Alerts that fire for things nobody needs to fix teach people to ignore alerts. So there are only eight rules, in two severities: _critical_ means users are affected now; _warning_ means look during working hours. Each links to its section of the [runbook](./runbook.md#alerts).

| Alert                              | Fires when                                         | For    |
| ---------------------------------- | -------------------------------------------------- | ------ |
| `LedgerlyApiDown` (critical)       | No API instance can be scraped                     | 1 min  |
| `LedgerlyWorkerDown` (critical)    | The worker can't be scraped                        | 2 min  |
| `LedgerlyHighErrorRate` (critical) | > 2% of requests answer 5xx (a ratio, not a count) | 5 min  |
| `LedgerlySlowRequests`             | p95 latency > 1 s, live-update streams excluded    | 10 min |
| `LedgerlyDatabasePoolExhausted`    | Requests queue for database connections            | 5 min  |
| `LedgerlyEventLoopBlocked`         | Event-loop lag p99 > 200 ms                        | 5 min  |
| `LedgerlyJobBacklog`               | The oldest due job has waited > 5 min              | 10 min |
| `LedgerlyJobsFailing`              | Any job used up its retries in the last 30 min     | —      |

The `for:` durations are what stop a brief blip from paging anyone.

**Alert rules are code, so they have tests.** `deploy/prometheus/alerts.test.yml` feeds `promtool` invented time series and states which alerts must fire when. For example, "with 5% errors, the high-error alert fires by minute 15; with 1%, it never does". CI runs them on every change.

**A test that couldn't fail.** The first latency test passed even with the stream exclusion deleted from the rule. When a percentile falls in the top `+Inf` bucket, Prometheus reports the upper bound of the highest _finite_ bucket, which in the test data was 1 s, and `1 > 1` is false. The test could never fire, with or without the exclusion. Adding the 10 s bucket that real data has, plus a test that genuinely slow requests _do_ fire the alert, made the deleted-exclusion version fail as it should.

**The trap only a live test found.** With the stack running, we stopped the worker container and watched Prometheus. The worker didn't show up as `up == 0`. It **vanished**: Docker's DNS stops listing a stopped container, so there was no series for `up == 0` to match, and the alert would have stayed silent while every import, email and budget alert stopped. Both "down" alerts now also fire on `absent(...)`. With the new rule, against the really-stopped worker, the alert went _pending_ after 40 seconds and _firing_ after its 2-minute `for:`. A promtool test (a series that goes `stale`) keeps it that way.

Prometheus _evaluates_ alerts; sending them somewhere (email, Slack, a pager) is Alertmanager's job. That needs your accounts, so it's left as a step in the runbook.

---

## 9. Backups you have actually restored

There's a saying in operations: _nobody cares about backups, only restores_. A backup you've never restored is a hope.

**Consistent.** `backup.sh` doesn't just call `pg_dump`. It opens a `REPEATABLE READ` transaction, **exports its snapshot**, and runs `pg_dump --snapshot=…` on it. Then it counts every table's rows _in that same snapshot_. The dump and its `.counts.json` manifest describe exactly the same moment, even while users keep writing. We proved it by backing up while a loop inserted rows continuously. The table had grown to 685 rows by the time the dump finished, and the backup recorded and contained exactly the 577 of its moment.

**Verifiable.** Each backup has a SHA-256 checksum, and it's only renamed from `.partial` once complete, so a crash mid-dump can never leave something that looks like a backup. It's uploaded off the server if `BACKUP_UPLOAD` is set: a backup on the same disk as the database dies with the disk.

**Drilled.** `restore-drill.sh` proves a backup is good without touching production:

1. verify the checksum;
2. restore into a **throwaway** Postgres of the same version, stopping at the first error;
3. compare **every table's row count** with the manifest;
4. run the app's own migrator against it (is the schema current?);
5. **boot the API** on the restored data and check it reports ready.

A drill that always passes proves nothing, so we fed it bad backups:

| Backup                               | Drill result                                             |
| ------------------------------------ | -------------------------------------------------------- |
| Good                                 | ✅ passed: 21 tables, every count identical, API ready   |
| One flipped byte                     | ✘ step 1: checksum did NOT match                         |
| Dump silently missing a table's data | ✘ step 3: `public.transactions` 448 expected, 0 restored |
| Taken during continuous writes       | ✅ passed: counts identical (the snapshot at work)       |

**The production restore itself was rehearsed** exactly as the runbook writes it: back up, simulate a disaster (all transactions deleted), stop the app, recreate the database, `pg_restore`, redeploy. 432 transactions before, 0 after the "disaster", 432 after the restore. A runbook nobody has followed is a draft.

Two numbers frame any backup plan:

- **RPO** (recovery point objective) is how much data you can lose. Hourly backups mean up to an hour.
- **RTO** (recovery time objective) is how long recovery takes. Here that's minutes: the restore took under a second for this data, plus a redeploy.

To lose less than an hour, use point-in-time recovery: continuous archiving of Postgres' write-ahead log, which every managed Postgres offers.

---

## 10. The pipeline

### 10.1 CI exercises the production machinery

The new `containers` job runs on every push, in about the time of the e2e job:

1. Build both images (layers cached between runs).
2. Run shellcheck on every script, then `promtool` on the Prometheus config and alert tests.
3. Create a throwaway production `.env`.
4. Do a **first deploy onto an empty server** with the real `deploy.sh`, then a **rolling deploy** of a second version.
5. Take a backup with the real `backup.sh`, then run the restore drill on it.

So every operational script runs on every change, and a refactor that breaks deploys fails CI instead of breaking a release. We replayed the whole sequence locally, from an empty Docker host, before committing.

### 10.2 Continuous deployment, off until you opt in

`.github/workflows/deploy.yml` runs after CI succeeds on `main`. It:

- publishes the images to GitHub Container Registry, tagged with the commit;
- copies the deploy files to the server over SSH;
- runs `deploy.sh` there.

It does **nothing at all** unless the repository variable `DEPLOY_ENABLED` is `true`. Publishing images and contacting a server are decisions for you to make, not side effects of a merge. The runbook walks through setting it up.

The safeguards in it:

- **Supply chain.** Images carry a signed _provenance_ attestation (what was built, from which commit, by which workflow) and an _SBOM_ (a list of every package inside). That is what lets you answer "are we affected?" when the next vulnerability in a popular library is announced.
- **Pinned SSH host key.** The deploy job refuses to talk to anything pretending to be our server.
- **No script injection.** Our first draft put `${{ inputs.sha }}` straight into a shell script. Text typed into the "Run workflow" form would have become shell code, executed on the runner and then on the server over SSH. That is the textbook GitHub Actions injection. Inputs now go through environment variables and must look like a commit SHA (`^[0-9a-f]{7,40}$`).
- **One deploy at a time**, never cancelled halfway (`concurrency` with `cancel-in-progress: false`).
- **An approval gate if you want one:** the `production` environment can require a reviewer.

### 10.3 Actions on a supported runtime

GitHub has removed Node 20 from its runners, and our actions only kept working because GitHub forced them onto Node 24. All of them moved to their current majors: checkout v7, setup-node v7, pnpm/action-setup v6, cache v6, upload-artifact v7, gitleaks v3. We read each project's release notes for breaking changes first. None affected an input we use; gitleaks v3, for example, states "no changes to inputs, outputs, or behavior". `actionlint` checks both workflows.

---

## 11. Results

| What                                 | Result                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Images                               | API 324 MB, web 329 MB (~160 MB shared Node base); non-root; read-only    |
| Empty server → running stack         | 19 s (`compose up --wait`); first `deploy.sh` ≈ 30 s                      |
| Rolling deploy                       | ≈ 30 s (API drains 5 s)                                                   |
| User requests failed during a deploy | **0 / 6,436**                                                             |
| … during a broken release + rollback | **0 / 5,805**                                                             |
| Backup of the demo data              | 108 KB, < 1 s; drill ≈ 10 s                                               |
| Alert rules / promtool test cases    | 8 / 8, incl. the vanished-target case                                     |
| Tests                                | 405 → **413** (db 35, api 190, shared 89, web 85, e2e 14) + 9 alert tests |

---

## 12. What testing caught this stage

1. **All users shared one rate-limit bucket** (load test during a deploy). Server-rendered API calls didn't carry the visitor's address. Under real traffic, everyone would have started getting errors.
2. **A busy proxy kept the old web server alive** (the same load test). Keep-alive reuse meant 30 seconds of stale responses, a failed smoke test and a rollback. Fixed with per-request connections and connection-refused retries.
3. **The "worker down" alert could never fire** (stopping the container in the live stack). DNS discovery makes a stopped target vanish instead of reading 0.
4. **The latency alert test couldn't fail** (mutation check). Without a finite bucket above the threshold, the quantile can never exceed it.
5. **The version was always `0.1.0` in containers.** It came from an environment variable only `pnpm` sets.
6. **Any client could write into our logs** through `X-Request-Id`.
7. **A metric label named `job`** would have been silently renamed by Prometheus.
8. **Script injection in the deploy workflow** (review). A form input reached a shell on the server.
9. **The monitoring tunnel in the runbook's first draft** published Prometheus on every interface while open. It now binds to `127.0.0.1`.
10. **Caddy's active health checks don't work with DNS-discovered upstreams** (reading the docs before building on them).
11. **`exec {SNAPSHOT[1]}>&-` doesn't close a coprocess's input** (shellcheck). The backup script would have relied on it.

Most of these are invisible to unit tests by nature. They live in the space _between_ components: proxies, DNS, signals, headers, time. The method found them: run the real thing, under load, and break it on purpose.

---

## 13. Run it yourself

```bash
# The images (from the repo root)
docker build -f apps/api/Dockerfile -t ghcr.io/a7madalabed/ledgerly-api:local .
docker build -f apps/web/Dockerfile -t ghcr.io/a7madalabed/ledgerly-web:local .

# A production stack on your machine
cp deploy/.env.example deploy/.env       # set SITE_ADDRESS=localhost; fill in the two secrets
SKIP_PULL=1 deploy/scripts/deploy.sh local
open https://localhost                    # accept the local certificate

# Monitoring
IMAGE_TAG=local docker compose --env-file deploy/.env -f deploy/compose.yaml --profile monitoring up -d prometheus

# Break it: stop the worker, watch the alert go pending, then firing (~2.5 min)
IMAGE_TAG=local docker compose --env-file deploy/.env -f deploy/compose.yaml stop worker

# Back up, and prove the backup restores
deploy/scripts/backup.sh
IMAGE_TAG=local deploy/scripts/restore-drill.sh

# The alert rules' unit tests
docker run --rm -v "$PWD/deploy/prometheus:/p" --entrypoint promtool prom/prometheus:v3.15.1 test rules /p/alerts.test.yml
```

For a real server and continuous deployment, follow the [runbook](./runbook.md#setting-up-a-server).

---

## 14. Exercises

1. **Watch a deploy under load.** Run a loop of `curl` requests against `https://localhost/login` in one terminal and `deploy.sh` with a new tag in another. Count non-200 responses. Then set `keepalive` back on in the Caddyfile, deploy again, and explain the difference.
2. **A migration that would break a rollback.** Write a migration that renames a column, and describe exactly what fails when the old version runs against it. Then split it into expand/contract releases.
3. **Make the drill fail at step 4.** Restore a backup taken before a migration was added. What does the drill report, and why is that a pass, not a failure?
4. **A new alert.** Write a rule (and its promtool test) for "the response cache hit ratio fell below 50% for 30 minutes". Is it a page, a warning, or not an alert at all? Argue it.
5. **Cardinality.** Change the metrics plugin to use `request.url` instead of the route template. Make 100 requests for different households and count the series. What would a million households do?
6. **Point-in-time recovery.** Read about Postgres WAL archiving (`archive_command`, `pg_basebackup`). What RPO could Ledgerly reach, and what would it cost to run?
7. **Kill -9.** `docker kill -s KILL` the API in the middle of an import. What happens to the import job (Stage 10), and why is nothing lost?

---

## 15. Glossary

| Term                         | Meaning                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| **Container image**          | A sealed, versioned package of an app and everything it needs to run.                               |
| **Multi-stage build**        | A Dockerfile with build stages and a final stage that copies only the runtime output.               |
| **Build once, run anywhere** | One artifact per commit, promoted through environments; only configuration differs.                 |
| **Reverse proxy**            | A server in front of your app that receives every request: TLS, routing, headers (Caddy here).      |
| **Rolling update**           | Replacing instances one at a time, so some are always serving.                                      |
| **Draining**                 | A shutting-down instance stops receiving new work while it finishes what it has.                    |
| **Liveness / readiness**     | "Is the process alive?" (restart if not) vs "should it receive traffic now?" (route around if not). |
| **Smoke test**               | A quick check that the basics work after a deploy, through the real entrance.                       |
| **Expand/contract**          | Splitting a schema change across releases so old and new code both work at every step.              |
| **Lock timeout**             | How long a statement may wait for a lock before giving up.                                          |
| **Structured logs**          | Logs as data (JSON fields), searchable and filterable, instead of free text.                        |
| **RED metrics**              | Rate, Errors, Duration: the three numbers that describe a request-serving system.                   |
| **Cardinality**              | The number of distinct label combinations (time series) a metric produces.                          |
| **Info metric**              | A series with value 1 whose labels carry facts, such as the running version.                        |
| **SLO-style alerting**       | Alerting on user-visible symptoms (errors, latency), not on every internal cause.                   |
| **RPO / RTO**                | How much data you can lose / how long recovery takes.                                               |
| **Restore drill**            | Regularly restoring a backup into a scratch environment to prove it works.                          |
| **Provenance / SBOM**        | A signed record of how an artifact was built / a list of everything inside it.                      |
| **Script injection**         | Untrusted text (an input, a branch name, a PR title) ending up as code in a CI script.              |
| **Runbook**                  | Step-by-step operating instructions, written to be followed under pressure.                         |

---

## 16. The whole journey, and where to go next

Fourteen stages ago, Ledgerly was an empty folder. Look at what it is now:

| Stages | What they gave Ledgerly                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1–2    | A typed monorepo, CI from day one, and a design system with tokens, motion and dark mode.                                       |
| 3–5    | A Postgres schema with real constraints, a validated and documented API, sessions, 2FA, and defence in depth.                   |
| 6–9    | An accessible app shell, fast transaction entry, charts that are both honest and beautiful, budgets, goals and recurring bills. |
| 10–11  | A transactional job queue, CSV imports, notifications, shared households and live collaboration.                                |
| 12     | Measured performance at 2 million transactions, and a capacity estimate.                                                        |
| 13     | A test strategy: property tests, browser journeys, accessibility checks, a contract snapshot, coverage that means something.    |
| 14     | Production: images, a hardened stack, zero-downtime deploys, metrics and alerts, proven backups, and a pipeline.                |

Along the way, the same habits kept paying off. Measure before believing. Break things on purpose. Keep the data honest: money as integers, dates as days, every invariant in the database. Make the system tell you when it's unwell.

### When you outgrow this setup

| Pressure                                | Next step                                                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The server is a single point of failure | Two app servers behind a cloud load balancer (with per-instance readiness, closing §7.2's gap) and a **managed Postgres** with a standby replica and point-in-time recovery. |
| You need to be paged                    | Alertmanager with a receiver; an external uptime check on `/healthz`.                                                                                                        |
| "Why was _this_ request slow?"          | Distributed tracing with OpenTelemetry (Fastify, pg and undici all have instrumentation), sent to a tracing backend.                                                         |
| Errors in users' browsers               | Client-side error reporting (e.g. Sentry) with source maps.                                                                                                                  |
| Dependencies drift                      | Dependabot or Renovate for npm packages, Docker base images and Actions, with CI as the safety net.                                                                          |
| Risky features                          | Feature flags, and canary releases (a slice of traffic on the new version first).                                                                                            |
| Many services, many servers             | Kubernetes, or a managed container platform. The images, health checks, shutdown and migrations job carry over as they are.                                                  |

The app is finished; operating it never is. That's the job, and it can be done well.
