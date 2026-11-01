import { randomInt } from "node:crypto";
import { Secret, TOTP } from "otpauth";

/**
 * TOTP (RFC 6238): the 6-digit codes in Google Authenticator, 1Password, Authy…
 * Server and app share a secret; both compute HMAC(secret, current 30-second
 * window) and keep 6 digits. No network needed, and a code is useless after ~30 s.
 */
const PERIOD = 30;

function totpFor(secretBase32: string, label = "Ledgerly") {
  return new TOTP({
    issuer: "Ledgerly",
    label,
    algorithm: "SHA1", // what every authenticator app supports
    digits: 6,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function createTotpSecret(): string {
  return new Secret({ size: 20 }).base32; // 160 bits, as RFC 4226 recommends
}

export function totpUri(secretBase32: string, email: string): string {
  return totpFor(secretBase32, email).toString();
}

/**
 * Returns the time step the code belongs to, or null if invalid.
 * window: 1 accepts the previous and next 30 s windows to tolerate clock drift.
 * The caller rejects steps <= the last one used, so a code can't be replayed.
 */
export function verifyTotp(secretBase32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totpFor(secretBase32).validate({ token: code, timestamp: now, window: 1 });
  if (delta === null) return null;
  return Math.floor(now / 1000 / PERIOD) + delta;
}

/**
 * Recovery codes like "7KQM-W2XD-HN4P": 12 characters from a 31-letter alphabet
 * without look-alikes (no 0/O, 1/I/L) ≈ 59 bits of entropy each.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  });
}

/** "7kqm w2xd-hn4p" → "7KQMW2XDHN4P": users type codes in all sorts of ways. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
