# Ledgerly

A personal and household finance dashboard, built **end to end, in stages**, as a hands-on course in how professional web apps are made.

Each stage ships working code **and** a deep-dive document in [`docs/`](./docs) explaining what was built, why, and why it's considered industry best practice.

## Stages

| #   | Stage                                                                         | Status  |
| --- | ----------------------------------------------------------------------------- | ------- |
| 1   | [Foundations & architecture](./docs/stage-01-foundations-and-architecture.md) | ✅ Done |
| 2   | [Design system](./docs/stage-02-design-system.md)                             | ✅ Done |
| 3   | [Database design](./docs/stage-03-database-design.md)                         | ✅ Done |
| 4   | [Backend API](./docs/stage-04-backend-api.md)                                 | ✅ Done |
| 5   | [Authentication & security](./docs/stage-05-authentication-and-security.md)   | ✅ Done |
| 6   | [Frontend app shell](./docs/stage-06-frontend-app-shell.md)                   | ✅ Done |
| 7   | [Transactions](./docs/stage-07-transactions.md)                               | ✅ Done |
| 8   | [Dashboard & charts](./docs/stage-08-dashboard-and-charts.md)                 | ✅ Done |
| 9   | [Budgets & goals](./docs/stage-09-budgets-and-goals.md)                       | ✅ Done |
| 10  | [Imports & background jobs](./docs/stage-10-imports-and-background-jobs.md)   | ✅ Done |
| 11  | [Households & real-time](./docs/stage-11-households-and-real-time.md)         | ✅ Done |
| 12  | [Performance & scalability](./docs/stage-12-performance-and-scalability.md)   | ✅ Done |
| 13  | [Testing strategy](./docs/stage-13-testing-strategy.md)                       | ✅ Done |
| 14  | [Deployment & operations](./docs/stage-14-deployment-and-operations.md)       | ✅ Done |
| 15  | [Launch readiness](./docs/stage-15-launch-readiness.md)                       | ✅ Done |

## Repository layout

```
apps/
  web/        Next.js front end (what users see)
  api/        Fastify HTTP API (business logic, data access) + the background worker
packages/
  shared/     Code used by both: Zod schemas, types, money helpers
  db/         PostgreSQL schema, migrations, queries and seed data (Drizzle ORM)
docker/       Config for local infrastructure (docker-compose.yml)
tools/perf/   Performance tooling: big dataset, load tests, Web Vitals (Stage 12)
e2e/          Browser end-to-end tests with Playwright, incl. accessibility (Stage 13)
deploy/       Production: Docker Compose stack, Caddy, Prometheus + alerts, deploy/backup scripts (Stage 14)
docs/         One document per stage
```

## Getting started

You need **Node.js 22.12+**, **pnpm 10** (`corepack enable` installs the right pnpm automatically) and **Docker** (for PostgreSQL).

```bash
pnpm install
```

```bash
cp apps/api/.env.example apps/api/.env && cp apps/web/.env.example apps/web/.env.local && cp packages/db/.env.example packages/db/.env
```

Generate a local encryption key (used to encrypt 2FA secrets at rest):

```bash
node -e "console.log('ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('base64'))" >> apps/api/.env
```

Start PostgreSQL, create the tables and load demo data:

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

`pnpm dev` starts three processes: the web app, the API, and the **background worker** that runs imports, scheduled tasks and notifications. Emails (sign-up confirmation, password reset, notifications) really are sent, over SMTP, to **Mailpit**, a local inbox that `pnpm db:up` starts next to Postgres: open http://localhost:8025 to read them. To print emails in the worker's log instead, set `MAIL_DRIVER=log` in `apps/api/.env`.

Then open http://localhost:3000 and sign in with **demo@ledgerly.app** / **correct-horse-ledger** (or create your own account). The demo household is shared with **jamie@ledgerly.app** (same password): sign in as Jamie in a second browser to see changes appear live. The living style guide is at http://localhost:3000/design. The API runs on http://localhost:4000 (try http://localhost:4000/health and http://localhost:4000/health/ready).

Interactive API documentation lives at **http://localhost:4000/docs**. Sign in through `POST /v1/auth/login` with the demo account **demo@ledgerly.app** / **correct-horse-ledger** (the docs page keeps the session cookie for you).

## Running it in production

The whole stack (HTTPS, the app, the worker, Postgres, monitoring) runs from the
container images with Docker Compose. Try it on your machine:

```bash
docker build -f apps/api/Dockerfile -t ghcr.io/a7madalabed/ledgerly-api:local .
```

```bash
docker build -f apps/web/Dockerfile -t ghcr.io/a7madalabed/ledgerly-web:local .
```

```bash
cp deploy/.env.example deploy/.env
```

Set `SITE_ADDRESS=localhost` in `deploy/.env` and fill in the two secrets it asks
for. Then deploy:

```bash
SKIP_PULL=1 deploy/scripts/deploy.sh local
```

Open https://localhost (accept the locally-issued certificate). For a real server,
continuous deployment from GitHub, backups, alerts and what to do when one fires,
see the **[runbook](./docs/runbook.md)**.

## Useful commands

| Command                          | What it does                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm dev`                       | Runs the web app, the API, the background worker and the shared package in watch mode   |
| `pnpm build`                     | Production build of everything                                                          |
| `pnpm test`                      | Runs the unit and integration tests                                                     |
| `pnpm test:coverage`             | The same, measuring coverage and enforcing each package's minimum                       |
| `pnpm e2e`                       | Builds and starts the whole stack, then runs the browser tests (`pnpm e2e:ui` to watch) |
| `deploy/scripts/deploy.sh <tag>` | Zero-downtime deploy of an image version, with automatic rollback (see the runbook)     |
| `pnpm lint`                      | Finds likely bugs and bad patterns                                                      |
| `pnpm typecheck`                 | Checks TypeScript types                                                                 |
| `pnpm format`                    | Auto-formats every file                                                                 |
| `pnpm check`                     | The fast checks CI runs (format, lint, types, tests), in one command                    |
| `pnpm db:up`                     | Starts PostgreSQL in Docker (`db:down` stops it)                                        |
| `pnpm db:migrate`                | Applies pending database migrations                                                     |
| `pnpm db:seed`                   | Replaces local data with a year of realistic demo data                                  |
| `pnpm db:reset`                  | Wipes the local database, migrates and seeds                                            |
| `pnpm db:generate`               | Creates a migration after you edit `packages/db/src/schema.ts`                          |
| `pnpm db:studio`                 | Opens Drizzle Studio, a web UI to browse your data                                      |
