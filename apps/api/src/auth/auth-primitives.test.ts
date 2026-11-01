import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./encryption.js";
import { hashPassword, needsRehash, passwordWeakness, verifyPassword } from "./password.js";
import { generateToken, sha256 } from "./tokens.js";
import {
  createTotpSecret,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  verifyTotp,
} from "./totp.js";
import { Secret, TOTP } from "otpauth";

describe("password hashing", () => {
  it("salts every hash and verifies correctly", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same-password-here"),
      hashPassword("same-password-here"),
    ]);
    expect(a).not.toBe(b); // different random salts
    expect(await verifyPassword(a, "same-password-here")).toBe(true);
    expect(await verifyPassword(a, "Same-password-here")).toBe(false);
    expect(await verifyPassword(null, "anything")).toBe(false);
    expect(needsRehash(a)).toBe(false);
    expect(needsRehash("$argon2id$v=19$m=4096,t=3,p=1$abc$def")).toBe(true);
  });

  it("flags weak passwords", () => {
    expect(passwordWeakness("password1234", { email: "a@b.co" })).toMatch(/leaked/);
    expect(passwordWeakness("zzzzzzzzzzzz", { email: "a@b.co" })).toMatch(/repeated/);
    expect(passwordWeakness("i-am-ledgerly-fan", { email: "a@b.co" })).toMatch(/app/);
    expect(passwordWeakness("violet-tractor-sunrise", { email: "a@b.co" })).toBeNull();
  });
});

describe("tokens", () => {
  it("are unique, URL-safe and 256-bit", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateToken));
    expect(tokens.size).toBe(1000);
    const token = [...tokens][0]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("encryption at rest", () => {
  const key = Buffer.alloc(32, 1);

  it("round-trips, uses a fresh IV each time, and detects tampering", () => {
    const a = encrypt("JBSWY3DPEHPK3PXP", key);
    const b = encrypt("JBSWY3DPEHPK3PXP", key);
    expect(a).not.toBe(b);
    expect(decrypt(a, key)).toBe("JBSWY3DPEHPK3PXP");

    const [version, iv, tag, ciphertext] = a.split(".");
    // Flip the FIRST character: the last base64 character can carry only padding
    // bits, so changing it may not change the decoded bytes at all.
    const flipped = (ciphertext!.startsWith("A") ? "B" : "A") + ciphertext!.slice(1);
    expect(() => decrypt([version, iv, tag, flipped].join("."), key)).toThrow();
    expect(() => decrypt(a, Buffer.alloc(32, 2))).toThrow(); // wrong key
  });
});

describe("TOTP", () => {
  const secret = createTotpSecret();
  const codeAt = (timestamp: number) =>
    new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp });

  it("accepts the current code and tolerates ±30 s of clock drift", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 15);
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, codeAt(now), now)).toBe(step);
    expect(verifyTotp(secret, codeAt(now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(secret, codeAt(now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(secret, codeAt(now - 90_000), now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", now)).toBeNull();
  });

  it("generates readable, unique recovery codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes)
      expect(code).toMatch(/^[2-9A-HJ-KM-NP-Z]{4}-[2-9A-HJ-KM-NP-Z]{4}-[2-9A-HJ-KM-NP-Z]{4}$/);
    expect(normalizeRecoveryCode(" ab3c-d4ef gh5j ")).toBe("AB3CD4EFGH5J");
  });
});
