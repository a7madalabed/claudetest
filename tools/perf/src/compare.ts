import { readFileSync } from "node:fs";
import type { Result } from "./load.js";

/** pnpm --filter @ledgerly/perf run compare -- baseline after-fixes */
const [before, after] = process.argv.slice(2).filter((a) => a !== "--");
const read = (label: string) =>
  JSON.parse(readFileSync(new URL(`../results/${label}.json`, import.meta.url), "utf8")) as {
    results: Result[];
  };
const a = read(before!);
const b = read(after!);

const change = (x: number, y: number) =>
  x === 0 ? "" : `${y < x ? "−" : "+"}${Math.abs(Math.round(((y - x) / x) * 100))}%`;
console.log(
  `| Endpoint | Profile | p99 ${before} | p99 ${after} | Δ | req/s ${before} | req/s ${after} |`,
);
console.log("|---|---|---:|---:|---:|---:|---:|");
for (const r of a.results) {
  const s = b.results.find((x) => x.endpoint === r.endpoint && x.profile === r.profile);
  if (!s) continue;
  console.log(
    `| ${r.endpoint} | ${r.profile} | ${r.p99} ms | ${s.p99} ms | ${change(r.p99, s.p99)} | ${r.rps} | ${s.rps} |`,
  );
}
