import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Session tokens: 32 bytes from the OS's cryptographically secure random number
 * generator = 256 bits of entropy. Guessing one is not "hard", it's physically
 * impossible. Never use Math.random() for anything security-related: it's
 * predictable.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256 is fine HERE (unlike for passwords) because the input is already
 * 256 random bits: there's nothing to brute-force. Fast hashing is OK when the
 * secret has high entropy; slow hashing is required when humans chose it.
 */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time string comparison (avoids leaking how many characters matched). */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}
