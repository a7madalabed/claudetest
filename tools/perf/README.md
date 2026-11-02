# @ledgerly/perf

Performance tooling for Stage 12 — see `docs/stage-12-performance-and-scalability.md`.

```bash
# 1. A large dataset (~2M transactions, 1,000 households) in ledgerly_perf
pnpm --filter @ledgerly/perf run dataset

# 2. The production build of the API, pointed at it (port 4100)
pnpm --filter @ledgerly/api build && pnpm --filter @ledgerly/perf run api

# 3. Load test every endpoint, then compare runs
pnpm --filter @ledgerly/perf run load -- --label before
pnpm --filter @ledgerly/perf run compare -- before after

# 4. Front-end: Web Vitals + budgets in Chromium (needs `next start` on :3000)
pnpm --filter @ledgerly/perf run web -- my-label
```

Never point these tools at real data: the dataset script refuses any database
whose name doesn't contain "perf".
