import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import autocannon from "autocannon";
import { API_URL, HEAVY, HOUSEHOLDS, tokenFor } from "./env.js";

/*
 * Load test: for each endpoint, hammer it with `connections` concurrent
 * clients for `duration` seconds, rotating through many households (so we
 * measure realistic data, not one hot household that fits in a cache).
 *
 *   pnpm --filter @ledgerly/perf run load -- --label baseline
 *
 * Reports requests/second and latency percentiles. p50 is the typical
 * request; p99 is the slowest 1% — the experience your unluckiest users get,
 * and usually the number that matters.
 */

const args = new Map(
  process.argv
    .slice(2)
    .flatMap((arg, i, all) => (arg.startsWith("--") ? [[arg.slice(2), all[i + 1] ?? ""]] : [])),
);
const label = args.get("label") || "run";
const connections = Number(args.get("connections") || 16);
const duration = Number(args.get("duration") || 6);
const only = args.get("only");

const householdId = (n: number) => uuidFromMd5(`household-${n}`);
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const month = today.slice(0, 7);
const monthsAgo = (k: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};
const nextMonth = monthsAgo(-1);

/** The requests the dashboard and main pages make, per household. */
export const ENDPOINTS: Array<{ name: string; path: (h: string) => string }> = [
  { name: "GET /me", path: () => "/v1/me" },
  { name: "accounts (with balances)", path: (h) => `/v1/households/${h}/accounts` },
  { name: "transactions, first page", path: (h) => `/v1/households/${h}/transactions?limit=50` },
  { name: "transactions summary", path: (h) => `/v1/households/${h}/transactions/summary` },
  {
    name: "cash flow, 6 months",
    path: (h) => `/v1/households/${h}/reports/cashflow?from=${monthsAgo(5)}&to=${nextMonth}`,
  },
  {
    name: "spending by category",
    path: (h) =>
      `/v1/households/${h}/reports/spending-by-category?from=${monthsAgo(5)}&to=${nextMonth}`,
  },
  {
    name: "net worth, 12 months",
    path: (h) => `/v1/households/${h}/reports/net-worth?from=${monthsAgo(11)}&to=${nextMonth}`,
  },
  {
    name: "daily cash flow, 2 months",
    path: (h) => `/v1/households/${h}/reports/daily-cashflow?from=${monthsAgo(1)}&to=${nextMonth}`,
  },
  { name: "budgets, this month", path: (h) => `/v1/households/${h}/budgets?month=${month}` },
  { name: "goals", path: (h) => `/v1/households/${h}/goals?today=${today}` },
  { name: "recurring bills", path: (h) => `/v1/households/${h}/reports/recurring?today=${today}` },
  { name: "notifications", path: () => "/v1/notifications" },
];

const PROFILES = {
  typical: Array.from({ length: HOUSEHOLDS - HEAVY }, (_, i) => HEAVY + 1 + i),
  heavy: Array.from({ length: HEAVY }, (_, i) => 1 + i),
};

export interface Result {
  endpoint: string;
  profile: keyof typeof PROFILES;
  rps: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  errors: number;
}

async function measure(
  endpoint: (typeof ENDPOINTS)[number],
  profile: keyof typeof PROFILES,
  seconds: number,
) {
  const pool = PROFILES[profile];
  let next = 0;
  const result = await autocannon({
    url: API_URL,
    connections,
    duration: seconds,
    // Each connection is one household's owner, assigned round-robin.
    initialContext: {} as { n?: number },
    requests: [
      {
        setupRequest: (request: autocannon.Request, context: { n?: number }) => {
          context.n ??= pool[next++ % pool.length]!;
          return {
            ...request,
            path: endpoint.path(householdId(context.n)),
            // Production cookies carry the __Host- prefix (Stage 5).
            headers: { cookie: `__Host-ledgerly_session=${tokenFor(context.n)}` },
          };
        },
      },
    ],
  } as autocannon.Options);
  return {
    endpoint: endpoint.name,
    profile,
    rps: Math.round(result.requests.average),
    p50: result.latency.p50,
    p90: result.latency.p90,
    p99: result.latency.p99,
    max: result.latency.max,
    errors: result.errors + result.non2xx,
  } satisfies Result;
}

const health = await fetch(`${API_URL}/health`).catch(() => null);
if (!health?.ok) {
  console.error(`❌ No API at ${API_URL}. Start it with: pnpm --filter @ledgerly/perf run api`);
  process.exit(1);
}

console.log(`Load test "${label}": ${connections} connections, ${duration}s per endpoint\n`);
console.log(
  `${"endpoint".padEnd(28)} ${"profile".padEnd(8)} ${"req/s".padStart(7)} ${"p50".padStart(6)} ${"p90".padStart(6)} ${"p99".padStart(6)} ${"errors".padStart(7)}`,
);
const results: Result[] = [];
for (const profile of ["typical", "heavy"] as const) {
  for (const endpoint of ENDPOINTS.filter((e) => !only || e.name.includes(only))) {
    await measure(endpoint, profile, 1); // warm-up: caches, JIT, connection pool
    const r = await measure(endpoint, profile, duration);
    results.push(r);
    console.log(
      `${r.endpoint.padEnd(28)} ${r.profile.padEnd(8)} ${String(r.rps).padStart(7)} ${`${r.p50}`.padStart(5)}ms ${`${r.p90}`.padStart(5)}ms ${`${r.p99}`.padStart(5)}ms ${String(r.errors).padStart(7)}`,
    );
  }
}

// Failed requests are FAST: a run with errors would look like a great result.
const failed = results.filter((r) => r.errors > 0);
if (failed.length > 0) {
  console.error(`\n❌ ${failed.length} endpoint runs had failed requests — results not saved.`);
  process.exit(1);
}

mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
const file = new URL(`../results/${label}.json`, import.meta.url);
writeFileSync(
  file,
  JSON.stringify({ label, at: new Date().toISOString(), connections, duration, results }, null, 2),
);
console.log(`\nSaved ${file.pathname}`);

function uuidFromMd5(input: string) {
  // Same as perf_uuid() in the dataset generator: md5, shaped into a valid v4 UUID.
  const md5 = createHash("md5").update(input).digest("hex");
  const hex = `${md5.slice(0, 12)}4${md5.slice(13, 16)}8${md5.slice(17)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
