import { DEMO_PASSWORD, eq, recoveryCodes, sessions, users } from "@ledgerly/db";
import type { LightMyRequestResponse } from "fastify";
import { Secret, TOTP } from "otpauth";
import { describe, expect, it } from "vitest";
import { OUTSIDER, OWNER, SESSION_COOKIE, request, useTestApp } from "../../test/helpers.js";

/** Pulls the session token out of a Set-Cookie response header. */
function sessionToken(response: LightMyRequestResponse): string | undefined {
  return response.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
}

/** Sends a request authenticated with a raw session token. */
function withToken(
  ctx: ReturnType<typeof useTestApp>,
  token: string | undefined,
  options: Parameters<typeof request>[2],
) {
  return ctx.app.inject({ ...options, cookies: token ? { [SESSION_COOKIE]: token } : {} });
}

/** What an authenticator app would show at a given moment. */
function totpCode(secret: string, timestamp = Date.now()) {
  return new TOTP({
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  }).generate({ timestamp });
}

describe("auth", () => {
  const ctx = useTestApp();

  const signup = (body: object) =>
    request(ctx.app, null, { method: "POST", url: "/v1/auth/signup", payload: body });
  const login = (email: string, password: string) =>
    request(ctx.app, null, { method: "POST", url: "/v1/auth/login", payload: { email, password } });

  describe("sign-up", () => {
    it("creates the user, a household with starter categories, and signs in", async () => {
      const response = await signup({
        email: "  Sam@Example.com ",
        password: "purple-monkey-dishwasher",
        displayName: "Sam Rivera",
      });
      expect(response.statusCode).toBe(201);
      const me = response.json();
      expect(me).toMatchObject({ email: "sam@example.com", mfaEnabled: false });
      expect(me.households).toEqual([
        expect.objectContaining({ name: "Sam's Household", role: "owner" }),
      ]);

      const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)!;
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });

      const categories = await withToken(ctx, cookie.value, {
        method: "GET",
        url: `/v1/households/${me.households[0].id}/categories`,
      });
      expect(categories.json().data.length).toBeGreaterThan(5);
    });

    it("stores an Argon2id hash, never the password", async () => {
      await signup({
        email: "hash@example.com",
        password: "purple-monkey-dishwasher",
        displayName: "H",
      });
      const [user] = await ctx.db.select().from(users).where(eq(users.email, "hash@example.com"));
      expect(user!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(user!.passwordHash).not.toContain("purple");
    });

    it("rejects short, common and email-containing passwords", async () => {
      const short = await signup({ email: "a@example.com", password: "short", displayName: "A" });
      expect(short.statusCode).toBe(400);
      const common = await signup({
        email: "b@example.com",
        password: "password1234",
        displayName: "B",
      });
      expect(common.json()).toMatchObject({ status: 422, code: "weak_password" });
      const containsEmail = await signup({
        email: "charlotte@example.com",
        password: "charlotte-is-great",
        displayName: "C",
      });
      expect(containsEmail.json().code).toBe("weak_password");
    });

    it("409 when the email is taken (case-insensitively)", async () => {
      const response = await signup({
        email: "DEMO@ledgerly.app",
        password: "purple-monkey-dishwasher",
        displayName: "X",
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("sign-in", () => {
    it("works with the right password and sets a session cookie", async () => {
      const response = await login(OWNER, DEMO_PASSWORD);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "authenticated", user: { email: OWNER } });
      const me = await withToken(ctx, sessionToken(response), { method: "GET", url: "/v1/me" });
      expect(me.statusCode).toBe(200);
    });

    it("gives the SAME answer for a wrong password and an unknown email (no user enumeration)", async () => {
      const wrongPassword = await login(OWNER, "definitely-not-it");
      const unknownEmail = await login("nobody@example.com", "definitely-not-it");
      expect(wrongPassword.statusCode).toBe(401);
      const { requestId: _a, ...a } = wrongPassword.json();
      const { requestId: _b, ...b } = unknownEmail.json();
      expect(a).toEqual(b);
      expect(sessionToken(wrongPassword)).toBeUndefined();
    });

    it("stores only a HASH of the session token", async () => {
      const token = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      const rows = await ctx.db.select().from(sessions);
      expect(rows.some((row) => row.tokenHash === token)).toBe(false);
      expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.tokenHash))).toBe(true);
    });

    it("rejects missing, tampered and expired session cookies", async () => {
      expect((await withToken(ctx, undefined, { method: "GET", url: "/v1/me" })).statusCode).toBe(
        401,
      );
      expect(
        (await withToken(ctx, "forged-token", { method: "GET", url: "/v1/me" })).statusCode,
      ).toBe(401);

      const token = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      await ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
      expect((await withToken(ctx, token, { method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    });

    it("enforces the idle timeout", async () => {
      const token = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      await ctx.db
        .update(sessions)
        .set({ lastSeenAt: new Date(Date.now() - 15 * 24 * 3600 * 1000) });
      expect((await withToken(ctx, token, { method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    });
  });

  describe("sessions", () => {
    it("logout deletes the session and clears the cookie", async () => {
      const token = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      const response = await withToken(ctx, token, { method: "POST", url: "/v1/auth/logout" });
      expect(response.statusCode).toBe(204);
      expect(response.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe("");
      expect((await withToken(ctx, token, { method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    });

    it("lists my devices and can sign out the others", async () => {
      const laptop = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      const phone = sessionToken(await login(OWNER, DEMO_PASSWORD))!;

      const list = (
        await withToken(ctx, laptop, { method: "GET", url: "/v1/auth/sessions" })
      ).json().data;
      expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
      expect(list.length).toBeGreaterThanOrEqual(3); // fixture session + laptop + phone

      await withToken(ctx, laptop, { method: "POST", url: "/v1/auth/sessions/revoke-others" });
      expect((await withToken(ctx, phone, { method: "GET", url: "/v1/me" })).statusCode).toBe(401);
      expect((await withToken(ctx, laptop, { method: "GET", url: "/v1/me" })).statusCode).toBe(200);
    });

    it("can't revoke someone else's session (404, and theirs keeps working)", async () => {
      const [outsider] = await ctx.db.select().from(users).where(eq(users.email, OUTSIDER));
      const [theirSession] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, outsider!.id));

      const response = await request(ctx.app, OWNER, {
        method: "DELETE",
        url: `/v1/auth/sessions/${theirSession!.id}`,
      });
      expect(response.statusCode).toBe(404);
      expect((await request(ctx.app, OUTSIDER, { method: "GET", url: "/v1/me" })).statusCode).toBe(
        200,
      );
    });
  });

  describe("password change", () => {
    it("requires the current password and signs out other devices", async () => {
      const current = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      const other = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      const change = (body: object) =>
        withToken(ctx, current, { method: "POST", url: "/v1/auth/password", payload: body });

      expect(
        (
          await change({
            currentPassword: "wrong-wrong-wrong",
            newPassword: "a-brand-new-passphrase",
          })
        ).json().code,
      ).toBe("wrong_password");
      expect(
        (await change({ currentPassword: DEMO_PASSWORD, newPassword: "a-brand-new-passphrase" }))
          .statusCode,
      ).toBe(204);

      expect((await withToken(ctx, other, { method: "GET", url: "/v1/me" })).statusCode).toBe(401);
      expect((await withToken(ctx, current, { method: "GET", url: "/v1/me" })).statusCode).toBe(
        200,
      );
      expect((await login(OWNER, "a-brand-new-passphrase")).statusCode).toBe(200);
      expect((await login(OWNER, DEMO_PASSWORD)).statusCode).toBe(401);
    });
  });

  describe("two-factor authentication", () => {
    /** Signs in, sets up and enables TOTP. Returns the secret, recovery codes and the step-0 time. */
    async function enableTotp() {
      const token = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      const setup = await withToken(ctx, token, { method: "POST", url: "/v1/auth/mfa/totp/setup" });
      expect(setup.statusCode).toBe(200);
      const { secret, otpauthUri } = setup.json();
      expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/Ledgerly:demo%40ledgerly\.app\?/);

      const enable = await withToken(ctx, token, {
        method: "POST",
        url: "/v1/auth/mfa/totp/enable",
        payload: { code: totpCode(secret) },
      });
      expect(enable.statusCode).toBe(200);
      return { secret, recoveryCodes: enable.json().recoveryCodes as string[] };
    }

    it("stores the TOTP secret encrypted and recovery codes hashed", async () => {
      const { secret, recoveryCodes: codes } = await enableTotp();
      const [user] = await ctx.db.select().from(users).where(eq(users.email, OWNER));
      expect(user!.totpSecretEncrypted).toMatch(/^v1\./);
      expect(user!.totpSecretEncrypted).not.toContain(secret);
      const stored = await ctx.db.select().from(recoveryCodes);
      expect(stored).toHaveLength(10);
      expect(stored.some((row) => codes.includes(row.codeHash))).toBe(false);
    });

    it("sign-in then requires a second step; the pending session can't access data", async () => {
      const { secret } = await enableTotp();
      const first = await login(OWNER, DEMO_PASSWORD);
      expect(first.json()).toMatchObject({ status: "mfa_required" });
      const pending = sessionToken(first)!;

      const blocked = await withToken(ctx, pending, { method: "GET", url: "/v1/me" });
      expect(blocked.statusCode).toBe(401);
      expect(blocked.json().code).toBe("mfa_required");

      const wrong = await withToken(ctx, pending, {
        method: "POST",
        url: "/v1/auth/login/mfa",
        payload: { code: "000000" },
      });
      expect(wrong.json().code).toBe("invalid_mfa_code");

      // The next 30-second window's code (the setup already used the current one).
      const code = totpCode(secret, Date.now() + 30_000);
      const verified = await withToken(ctx, pending, {
        method: "POST",
        url: "/v1/auth/login/mfa",
        payload: { code },
      });
      expect(verified.json()).toMatchObject({
        status: "authenticated",
        user: { mfaEnabled: true },
      });

      // A brand-new token is issued; the pending one is dead (no session fixation).
      const full = sessionToken(verified)!;
      expect(full).not.toBe(pending);
      expect((await withToken(ctx, full, { method: "GET", url: "/v1/me" })).statusCode).toBe(200);
      expect((await withToken(ctx, pending, { method: "GET", url: "/v1/me" })).statusCode).toBe(
        401,
      );

      // Replaying the same code on another sign-in fails.
      const again = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      const replay = await withToken(ctx, again, {
        method: "POST",
        url: "/v1/auth/login/mfa",
        payload: { code },
      });
      expect(replay.json().code).toBe("invalid_mfa_code");
    });

    it("a recovery code works exactly once, in any format", async () => {
      const { recoveryCodes: codes } = await enableTotp();
      const messy = codes[0]!.toLowerCase().replace(/-/g, " ");

      const first = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      const ok = await withToken(ctx, first, {
        method: "POST",
        url: "/v1/auth/login/mfa",
        payload: { code: messy },
      });
      expect(ok.json().status).toBe("authenticated");

      const second = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      const reused = await withToken(ctx, second, {
        method: "POST",
        url: "/v1/auth/login/mfa",
        payload: { code: codes[0] },
      });
      expect(reused.statusCode).toBe(401);
    });

    it("disabling requires the password AND a code", async () => {
      const { recoveryCodes: codes } = await enableTotp();
      const pending = sessionToken(await login(OWNER, DEMO_PASSWORD))!;
      const token = sessionToken(
        await withToken(ctx, pending, {
          method: "POST",
          url: "/v1/auth/login/mfa",
          payload: { code: codes[0] },
        }),
      )!;

      const noPassword = await withToken(ctx, token, {
        method: "POST",
        url: "/v1/auth/mfa/totp/disable",
        payload: { password: "wrong-password!", code: codes[1] },
      });
      expect(noPassword.json().code).toBe("wrong_password");

      const disabled = await withToken(ctx, token, {
        method: "POST",
        url: "/v1/auth/mfa/totp/disable",
        payload: { password: DEMO_PASSWORD, code: codes[1] },
      });
      expect(disabled.statusCode).toBe(204);
      expect((await login(OWNER, DEMO_PASSWORD)).json().status).toBe("authenticated");
    });
  });
});
