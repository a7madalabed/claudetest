/** Configuration for the performance tools. Everything has a local default. */
try {
  process.loadEnvFile();
} catch {
  // no .env — defaults below
}

export const PERF_DATABASE_URL =
  process.env.PERF_DATABASE_URL ?? "postgres://ledgerly:ledgerly@localhost:5432/ledgerly_perf";

/** The API under test (started separately, pointed at the perf database). */
export const API_URL = process.env.PERF_API_URL ?? "http://localhost:4100";

/** Household 1..HEAVY are "heavy" (years of busy data); the rest are typical. */
export const HOUSEHOLDS = Number(process.env.PERF_HOUSEHOLDS ?? 1_000);
export const HEAVY = Number(process.env.PERF_HEAVY ?? 10);
export const HEAVY_TRANSACTIONS = 50_000;
export const TYPICAL_TRANSACTIONS = 1_500;

if (!/perf/i.test(new URL(PERF_DATABASE_URL).pathname)) {
  // The setup script WIPES this database. Never point it at real data.
  throw new Error('PERF_DATABASE_URL must point at a database whose name contains "perf"');
}

/** The session token for perf user n (sessions are created directly in the database). */
export const tokenFor = (n: number) => `perf-session-token-${String(n).padStart(6, "0")}`;
