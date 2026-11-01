import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption at rest for secrets we must be able to READ back (unlike passwords,
 * which we only ever compare). TOTP secrets are the example: to check a 2FA code
 * we need the original secret, so we can't hash it — we encrypt it.
 *
 * AES-256-GCM is "authenticated encryption": besides hiding the data, the auth
 * tag detects any tampering with the ciphertext.
 *
 * Format: v1.<iv>.<tag>.<ciphertext> (base64url). The "v1" key version lets us
 * rotate to a new key later: decrypt with the old, re-encrypt with the new.
 */
const VERSION = "v1";

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12); // never reuse an IV with the same key in GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decrypt(payload: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext)
    throw new Error("Unsupported encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
