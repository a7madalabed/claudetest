import { authThrottles, inArray, sql, type DbExecutor } from "@ledgerly/db";
import { AppError } from "../../lib/errors.js";

/*
 * Attempt limits for anything protected by a secret (Stage 15).
 *
 * WHY THE DATABASE: the per-process rate limiter's counters live in memory.
 * Every deploy restarts the processes (a fresh allowance for an attacker every
 * time), and N API instances means N separate allowances. These counters are
 * rows in Postgres: one truth for every instance, surviving every deploy.
 *
 * WHY "COUNT FIRST": checking "fewer than 5 failures?" and then recording a
 * failure afterwards is a race. Send 100 guesses at the same moment and all 100
 * pass the check before any failure is written. Here every attempt atomically
 * counts ITSELF (one UPSERT, which locks the row) before the secret is even
 * looked at; a success then clears the counter. Parallel guessing gains nothing.
 */

export interface Limit {
  /** What is being limited, e.g. `login:account:sam@example.com`. */
  key: string;
  /** Attempts allowed per window. */
  max: number;
  windowSeconds: number;
  /**
   * Counts VOLUME from one address. These obey RATE_LIMIT_ENABLED, so the
   * end-to-end suite and load tests (thousands of sign-ups from 127.0.0.1) can
   * run. Limits that protect a specific ACCOUNT can never be switched off.
   */
  perIp?: true;
}

/**
 * Count one attempt against the limits, NARROWEST FIRST; throw 429 if one is exhausted.
 *
 * An attempt that a narrower limit already refused is NOT counted against the
 * broader ones (Stage 16). Otherwise one address, long blocked from guessing
 * an account's password, could keep sending requests until the ACCOUNT-wide
 * counter filled up — and lock the real owner out, from everywhere, forever.
 */
export async function consumeAttempt(
  db: DbExecutor,
  limits: Limit[],
  { ipLimits = true }: { ipLimits?: boolean } = {},
): Promise<void> {
  let retryAfter = 0;
  for (const limit of limits) {
    if (retryAfter > 0) break;
    if (limit.perIp && !ipLimits) continue;
    // A window that has expired restarts at 1; otherwise count up.
    const { rows } = await db.execute<{ attempts: number; retry_after: number }>(sql`
      insert into auth_throttles (key, attempts, window_started_at)
      values (${limit.key}, 1, now())
      on conflict (key) do update set
        attempts = case
          when auth_throttles.window_started_at < now() - make_interval(secs => ${limit.windowSeconds}) then 1
          else auth_throttles.attempts + 1 end,
        window_started_at = case
          when auth_throttles.window_started_at < now() - make_interval(secs => ${limit.windowSeconds}) then now()
          else auth_throttles.window_started_at end
      returning attempts,
        ceil(extract(epoch from window_started_at + make_interval(secs => ${limit.windowSeconds}) - now()))::int as retry_after`);
    const row = rows[0]!;
    if (row.attempts > limit.max) retryAfter = Math.max(retryAfter, row.retry_after);
  }
  if (retryAfter > 0) {
    const minutes = Math.max(1, Math.ceil(retryAfter / 60));
    throw new AppError(
      429,
      "too_many_attempts",
      "Too many attempts",
      `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      undefined,
      { "retry-after": String(retryAfter) },
    );
  }
}

/** After a success: forget the attempts that led to it. */
export async function clearAttempts(db: DbExecutor, keys: string[]): Promise<void> {
  if (keys.length > 0) await db.delete(authThrottles).where(inArray(authThrottles.key, keys));
}

/** Every login counter for one account, whichever address it came from. */
export async function clearAccountLoginAttempts(db: DbExecutor, email: string): Promise<void> {
  const account = normalise(email);
  await db.execute(sql`
    delete from auth_throttles
     where key = ${`login:account:${account}`}
        or (starts_with(key, 'login:ip-account:') and right(key, ${account.length + 1}) = ${`:${account}`})`);
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const normalise = (email: string) => email.trim().toLowerCase();

/*
 * The limits, narrowest first. Each answers a specific attack:
 *  - one IP guessing one account's password      → ip+account, tight
 *  - many IPs guessing ONE account (a botnet)    → account. An attacker with
 *    many addresses can trip it, so it never applies to a browser the owner
 *    has signed in from before ("known device", see auth.routes.ts): the
 *    owner's own devices can't be locked out by someone else
 *  - one IP trying a password on many accounts   → ip ("password spraying")
 */
export const limits = {
  login: (ip: string, email: string, { knownDevice = false } = {}): Limit[] => [
    { key: `login:ip-account:${ip}:${normalise(email)}`, max: 5, windowSeconds: 15 * MINUTE },
    ...(knownDevice
      ? []
      : [{ key: `login:account:${normalise(email)}`, max: 20, windowSeconds: 15 * MINUTE }]),
    { key: `login:ip:${ip}`, max: 100, windowSeconds: 15 * MINUTE, perIp: true },
  ],
  /** A 6-digit code has 1,000,000 values: 5 tries per 15 minutes per ACCOUNT, however many sessions. */
  secondFactor: (userId: string): Limit[] => [
    { key: `mfa:user:${userId}`, max: 5, windowSeconds: 15 * MINUTE },
  ],
  /** Re-entering a password to confirm something sensitive (disable 2FA, delete account…). */
  reauth: (userId: string): Limit[] => [
    { key: `reauth:user:${userId}`, max: 5, windowSeconds: 15 * MINUTE },
  ],
  /** Each request sends an email: limit per address (no inbox flooding) and per IP. */
  passwordResetRequest: (ip: string, email: string): Limit[] => [
    { key: `reset:email:${normalise(email)}`, max: 3, windowSeconds: HOUR },
    { key: `reset:ip:${ip}`, max: 20, windowSeconds: HOUR, perIp: true },
  ],
  verificationEmail: (userId: string): Limit[] => [
    { key: `verify:user:${userId}`, max: 3, windowSeconds: HOUR },
  ],
  /** The heaviest query in the app: everything a user can see. */
  dataExport: (userId: string): Limit[] => [
    { key: `export:user:${userId}`, max: 10, windowSeconds: HOUR },
  ],
  signup: (ip: string): Limit[] => [
    { key: `signup:ip:${ip}`, max: 10, windowSeconds: HOUR, perIp: true },
  ],
};
