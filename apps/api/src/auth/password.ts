import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing with Argon2id — the winner of the Password Hashing Competition
 * and OWASP's first recommendation.
 *
 * Why not SHA-256? Because it's FAST: a GPU computes billions per second, so a
 * leaked table of SHA-256 password hashes is cracked in hours. Argon2id is slow
 * on purpose AND memory-hard (each guess needs 19 MiB of RAM), which makes
 * GPU/ASIC cracking farms dramatically less effective.
 *
 * Parameters: OWASP's recommended minimum (m=19 MiB, t=2, p=1). ~25 ms per hash
 * on a server: invisible to a user, crippling for an attacker making billions of guesses.
 */
const OPTIONS = {
  algorithm: 2, // Argon2id (the library's const enum can't be imported under isolatedModules)
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes include a random per-password SALT, so equal passwords get different hashes. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/**
 * A real hash of a random string. When an email doesn't exist we still run a full
 * verification against this, so "unknown email" and "wrong password" take the SAME
 * time. Otherwise an attacker could time responses to discover which emails have
 * accounts (user enumeration).
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$W0iputdjrpcQRR0LqBrE6g$Ko8MC2kIwCPrxcxu7vTrLVsD/dCcXKAjYBtuiUnlco0"; // gitleaks:allow (not a secret)

export async function verifyPassword(passwordHash: string | null | undefined, password: string) {
  try {
    return await verify(passwordHash ?? DUMMY_HASH, password);
  } catch {
    return false;
  }
}

/** True if a stored hash used weaker/older parameters and should be upgraded on next login. */
export function needsRehash(passwordHash: string): boolean {
  return !passwordHash.startsWith(
    `$argon2id$v=19$m=${OPTIONS.memoryCost},t=${OPTIONS.timeCost},p=${OPTIONS.parallelism}$`,
  );
}

/**
 * A tiny sample of the most common leaked passwords (12+ characters, since shorter
 * ones are already rejected). Production systems check the full Have I Been Pwned
 * corpus (~1 billion passwords) using its k-anonymity API — see the Stage 5 doc.
 */
const COMMON_PASSWORDS = new Set([
  "123456789012",
  "1234567890123",
  "qwertyuiopas",
  "password1234",
  "password12345",
  "passwordpassword",
  "iloveyou1234",
  "qwerty123456",
  "123456789abc",
  "letmein12345",
  "welcome12345",
  "administrator",
  "changeme1234",
  "aaaaaaaaaaaa",
  "abcdefghijkl",
  "abc123456789",
  "trustno1trustno1",
  "monkey123456",
  "football1234",
  "baseball1234",
]);

/** Server-side strength checks beyond the length rules in the shared schema. */
export function passwordWeakness(
  password: string,
  context: { email: string; displayName?: string },
): string | null {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower))
    return "This password appears in lists of leaked passwords. Choose another.";
  if (/^(.)\1+$/.test(password)) return "Don't use a single repeated character.";
  const localPart = context.email.split("@")[0]!.toLowerCase();
  if (localPart.length >= 4 && lower.includes(localPart))
    return "Don't include your email address in your password.";
  if (lower.includes("ledgerly")) return "Don't include the name of this app in your password.";
  return null;
}
