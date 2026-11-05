// Signed-in traffic through the public entrance while a deploy runs (Stage 17).
//
//   node tools/perf/scripts/deploy-under-load.mjs <base-url> <stop-file>
//
// Signs up a user, then keeps requesting four kinds of page (API calls through
// the web server's /api proxy, a server-rendered page, a plain page) until
// <stop-file> exists. Prints a tally, and exits 1 if ANY request failed:
// a 5xx, or no answer at all. That's the claim "a deploy fails no requests",
// checked on every CI run instead of measured once (Stage 14 measured 0;
// Stage 17 found 1 per deploy, then fixed it).
//
// For https://localhost (Caddy's own CA), set NODE_EXTRA_CA_CERTS to Caddy's
// root certificate. Rate limiting must be off: all the traffic comes from one
// address, and 429s would hide what we're measuring.
import { existsSync } from "node:fs";

const [base, stopFile] = process.argv.slice(2);
if (!base || !stopFile) {
  console.error("usage: deploy-under-load.mjs <base-url> <stop-file>");
  process.exit(2);
}

const signup = await fetch(`${base}/api/v1/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({
    email: `deploy-check-${Date.now()}@example.test`,
    password: "steady-traffic-through-a-deploy",
    displayName: "Deploy Check",
  }),
});
if (signup.status !== 201) {
  console.error(`sign-up failed: ${signup.status} ${await signup.text()}`);
  process.exit(1);
}
const cookie = signup.headers.get("set-cookie").split(";")[0];
const household = (await signup.json()).households[0].id;

const targets = [
  ["api /me", `${base}/api/v1/me`],
  ["api transactions", `${base}/api/v1/households/${household}/transactions?limit=20`],
  ["server-rendered /app", `${base}/app/${household}`],
  ["page /healthz", `${base}/healthz`],
];
const tally = {};
const failures = [];

async function loop([name, url]) {
  while (!existsSync(stopFile)) {
    const at = new Date().toISOString();
    let outcome;
    try {
      const response = await fetch(url, {
        headers: { cookie },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      await response.arrayBuffer();
      outcome = String(response.status);
      if (response.status >= 500) failures.push({ name, outcome, at });
    } catch (error) {
      outcome = `no answer (${error.cause?.code ?? error.name})`;
      failures.push({ name, outcome, at });
    }
    tally[name] ??= {};
    tally[name][outcome] = (tally[name][outcome] ?? 0) + 1;
  }
}

// Some concurrency, like real users: LOAD_CONCURRENCY loops per target (default 2).
const perTarget = Number(process.env.LOAD_CONCURRENCY ?? 2);
await Promise.all(
  Array.from({ length: perTarget }, () => targets)
    .flat()
    .map(loop),
);

const total = Object.values(tally).reduce(
  (sum, outcomes) => sum + Object.values(outcomes).reduce((a, b) => a + b, 0),
  0,
);
console.log(JSON.stringify(tally, null, 2));
console.log(`${failures.length} of ${total} requests failed`);
for (const failure of failures.slice(0, 20)) console.log("  ", JSON.stringify(failure));
process.exit(failures.length === 0 ? 0 : 1);
