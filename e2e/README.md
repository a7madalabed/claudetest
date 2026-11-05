# @ledgerly/e2e — browser end-to-end tests

Playwright drives a real Chromium against the real stack: the **built** web app,
the **built** API, the background worker and a fresh Postgres database. Nothing
is mocked. See [the Stage 13 doc](../docs/stage-13-testing-strategy.md) for the why.

```bash
# Once per machine: download Playwright's Chromium.
pnpm --filter @ledgerly/e2e exec playwright install chromium

# Postgres and Mailpit must be running (pnpm db:up starts both). Then, from the repository root:
pnpm e2e        # build, start everything, run all tests
pnpm e2e:ui     # the same in Playwright's UI mode: watch, pause, time-travel
```

| Where                  | What                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `playwright.config.ts` | Servers to start, retries (CI only), traces, browser settings           |
| `scripts/servers.ts`   | Resets the e2e database, starts the built API and worker on port 4100   |
| `src/fixtures.ts`      | A fresh user per test, an account, categories, an API client, axe scans |
| `tests/*.spec.ts`      | The journeys, plus accessibility scans of every page in both themes     |

The web app runs from its normal standalone build (`apps/web/.next/standalone`),
with `API_URL` given at runtime. The suite uses its own ports (web 3100, API 4100) and database
(`ledgerly_e2e_test`), so it runs alongside `pnpm dev` without touching your data.
Override with `E2E_WEB_PORT`, `E2E_API_PORT` and `E2E_DATABASE_URL`.

Tests that involve email read the **real** message the worker sent, from Mailpit's
API (`src/mail.ts`), and follow the link in it, exactly as a person would. Every test
also fails if the browser reports a Content Security Policy violation (`cspGuard` in
`src/fixtures.ts`): a too-strict policy breaks pages silently, so it has to be caught.

A failed run leaves screenshots in `test-results/`. In CI, failed tests are retried
and the retry records a **trace**: download the `playwright-report` artifact and open
it with `pnpm --filter @ledgerly/e2e report`.
