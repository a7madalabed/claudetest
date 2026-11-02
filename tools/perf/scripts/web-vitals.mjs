/* global window -- the functions passed to addInitScript/evaluate run INSIDE the browser */
// Front-end performance, measured in a real browser (Stage 12).
//
//   node scripts/web-vitals.mjs <label>       (needs `next start` on :3000 and the API)
//
// For each page, in a FRESH browser context (empty cache — a first visit):
//   · JS downloaded (compressed bytes over the wire, and uncompressed)
//   · LCP  Largest Contentful Paint: when the main content appeared
//   · CLS  Cumulative Layout Shift: how much the page jumped around
//   · TBT  Total Blocking Time: main-thread time stuck in tasks > 50 ms
//          (the lab stand-in for INP: how sluggish the page feels to taps)
// with 4× CPU slowdown and a "fast 4G" network, roughly a mid-range phone.
//
// Plain JavaScript on purpose: Playwright is installed globally on this
// machine (not a project dependency), so this script isn't type-checked.
import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const label = process.argv.slice(2).find((a) => a !== "--") ?? "web";
const BASE = process.env.WEB_URL ?? "http://localhost:3000";

const browser = await chromium.launch();
// Sign in once; every page is then measured in a new, empty-cache context.
const setup = await browser.newContext();
const page0 = await setup.newPage();
await page0.goto(`${BASE}/login`);
await page0.getByLabel("Email").fill("demo@ledgerly.app");
await page0.getByLabel("Password", { exact: true }).fill("correct-horse-ledger");
await page0.getByRole("button", { name: "Sign in" }).click();
await page0.waitForURL(/\/app\/[0-9a-f-]{36}/);
const home = new URL(page0.url()).pathname.match(/\/app\/[0-9a-f-]{36}/)[0];
const storageState = await setup.storageState();
await setup.close();

const PAGES = {
  "Sign in": "/login",
  Dashboard: home,
  Transactions: `${home}/transactions`,
  Budgets: `${home}/budgets`,
  Imports: `${home}/imports`,
  Household: `${home}/household`,
};

const results = [];
for (const [name, path] of Object.entries(PAGES)) {
  const runs = [];
  // The sign-in page must be measured signed OUT (signed in, it redirects to the dashboard).
  for (let i = 0; i < 3; i++)
    runs.push(await measure(path, path === "/login" ? undefined : storageState));
  // Median of three runs: one slow outlier shouldn't decide the number.
  const median = (key) => runs.map((r) => r[key]).sort((a, b) => a - b)[1];
  const r = { page: name, ...Object.fromEntries(Object.keys(runs[0]).map((k) => [k, median(k)])) };
  results.push(r);
  console.log(
    `${name.padEnd(13)} JS ${String(r.jsKb).padStart(4)} KB wire / ${String(r.jsRawKb).padStart(4)} KB raw · ${String(r.jsFiles).padStart(2)} files · LCP ${String(r.lcp).padStart(5)} ms · CLS ${r.cls.toFixed(3)} · TBT ${String(r.tbt).padStart(4)} ms`,
  );
}

async function measure(path, state) {
  const context = await browser.newContext({
    storageState: state,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 60, // ms round trip
    downloadThroughput: (9 * 1024 * 1024) / 8, // 9 Mbit/s
    uploadThroughput: (3 * 1024 * 1024) / 8,
  });
  await page.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0, tbt: 0 };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__vitals.lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__vitals.tbt += Math.max(0, e.duration - 50);
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000); // let late layout shifts and long tasks land
  const data = await page.evaluate(() => {
    const js = performance
      .getEntriesByType("resource")
      .filter((e) => e.name.endsWith(".js") || e.initiatorType === "script");
    return {
      ...window.__vitals,
      jsWire: js.reduce((s, e) => s + e.transferSize, 0),
      jsRaw: js.reduce((s, e) => s + e.decodedBodySize, 0),
      jsFiles: js.length,
    };
  });
  await context.close();
  return {
    jsKb: Math.round(data.jsWire / 1024),
    jsRawKb: Math.round(data.jsRaw / 1024),
    jsFiles: data.jsFiles,
    lcp: Math.round(data.lcp),
    cls: Math.round(data.cls * 1000) / 1000,
    tbt: Math.round(data.tbt),
  };
}

await browser.close();

// Performance BUDGETS: limits agreed in advance, checked on every run. A budget
// turns "the app got slower" from an opinion into a failing check. Limits sit
// a little above today's numbers: room for honest growth, none for accidents.
const BUDGETS = { jsKb: 400, lcp: 2500, cls: 0.1 }; // KB compressed · ms · score
const over = results.flatMap((r) =>
  Object.entries(BUDGETS)
    .filter(([key, limit]) => r[key] > limit)
    .map(([key, limit]) => `${r.page}: ${key} ${r[key]} > ${limit}`),
);
if (over.length) {
  console.error(`\n❌ Over budget:\n  ${over.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log(
    `\n✅ Within budget (JS ≤ ${BUDGETS.jsKb} KB, LCP ≤ ${BUDGETS.lcp} ms, CLS ≤ ${BUDGETS.cls})`,
  );
}
mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../results/${label}.json`, import.meta.url),
  JSON.stringify({ label, at: new Date().toISOString(), results }, null, 2),
);
