# Ledgerly

A personal and household finance dashboard, built **end to end, in stages**, as a hands-on course in how professional web apps are made.

Each stage ships working code **and** a deep-dive document in [`docs/`](./docs) explaining what was built, why, and why it's considered industry best practice.

## Stages

| #   | Stage                                                                         | Status  |
| --- | ----------------------------------------------------------------------------- | ------- |
| 1   | [Foundations & architecture](./docs/stage-01-foundations-and-architecture.md) | ✅ Done |
| 2   | [Design system](./docs/stage-02-design-system.md)                             | ✅ Done |
| 3   | [Database design](./docs/stage-03-database-design.md)                         | ✅ Done |
| 4   | Backend API                                                                   | ⏳      |
| 5   | Authentication & security                                                     | ⏳      |
| 6   | Frontend app shell                                                            | ⏳      |
| 7   | Transactions                                                                  | ⏳      |
| 8   | Dashboard & charts                                                            | ⏳      |
| 9   | Budgets & goals                                                               | ⏳      |
| 10  | Imports & background jobs                                                     | ⏳      |
| 11  | Households & real-time                                                        | ⏳      |
| 12  | Performance & scalability                                                     | ⏳      |
| 13  | Testing strategy                                                              | ⏳      |
| 14  | Deployment & operations                                                       | ⏳      |

## Repository layout

```
apps/
  web/        Next.js front end (what users see)
  api/        Fastify HTTP API (business logic, data access)
packages/
  shared/     Code used by both: Zod schemas, types, money helpers
  db/         PostgreSQL schema, migrations, queries and seed data (Drizzle ORM)
docker/       Config for local infrastructure (docker-compose.yml)
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

Start PostgreSQL, create the tables and load demo data:

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

Then open http://localhost:3000 (and the living style guide at http://localhost:3000/design). The API runs on http://localhost:4000 (try http://localhost:4000/health and http://localhost:4000/health/ready).

## Useful commands

| Command            | What it does                                                   |
| ------------------ | -------------------------------------------------------------- |
| `pnpm dev`         | Runs the web app, the API and the shared package in watch mode |
| `pnpm build`       | Production build of everything                                 |
| `pnpm test`        | Runs all tests                                                 |
| `pnpm lint`        | Finds likely bugs and bad patterns                             |
| `pnpm typecheck`   | Checks TypeScript types                                        |
| `pnpm format`      | Auto-formats every file                                        |
| `pnpm check`       | Everything CI runs, in one command                             |
| `pnpm db:up`       | Starts PostgreSQL in Docker (`db:down` stops it)               |
| `pnpm db:migrate`  | Applies pending database migrations                            |
| `pnpm db:seed`     | Replaces local data with a year of realistic demo data         |
| `pnpm db:reset`    | Wipes the local database, migrates and seeds                   |
| `pnpm db:generate` | Creates a migration after you edit `packages/db/src/schema.ts` |
| `pnpm db:studio`   | Opens Drizzle Studio, a web UI to browse your data             |
