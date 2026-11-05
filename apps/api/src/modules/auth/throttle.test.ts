import { DEMO_PASSWORD, createDb } from "@ledgerly/db";
import { Secret, TOTP } from "otpauth";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { API_TEST_DATABASE_URL } from "../../test/database.js";
import { OWNER, SESSION_COOKIE, request, testEnv, useTestApp } from "../../test/helpers.js";

/** Not Secure in tests (COOKIE_SECURE=false), so without the __Host- prefix. */
const DEVICE_COOKIE = "ledgerly_device";

const code = (secret: string) =>
  new TOTP({
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  }).generate();

describe("attempt limits (database-backed)", () => {
  const ctx = useTestApp({ RATE_LIMIT_ENABLED: "true" });
  const login = (app: typeof ctx.app, email: string, password: string) =>
    request(app, null, { method: "POST", url: "/v1/auth/login", payload: { email, password } });

  it("survive a restart, and hold on every instance", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(ctx.app, OWNER, "wrong-password")).statusCode).toBe(401);
    }
    // A SECOND app on the same database: a newly deployed instance, or a replica.
    // With in-memory counters this would be a fresh allowance.
    const database = createDb({ connectionString: API_TEST_DATABASE_URL, maxConnections: 2 });
    const other = await buildApp(testEnv({ RATE_LIMIT_ENABLED: "true" }), {
      db: database.db,
      closeDb: database.close,
    });
    try {
      const blocked = await login(other, OWNER, DEMO_PASSWORD);
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().code).toBe("too_many_attempts");
    } finally {
      await other.close();
    }
  });

  it("can't be raced: twenty guesses at the same moment still get only five", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => login(ctx.app, OWNER, "wrong-password")),
    );
    const statuses = responses.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });

  it("a successful sign-in clears the account's failures", async () => {
    for (let i = 0; i < 4; i++) await login(ctx.app, OWNER, "wrong-password");
    expect((await login(ctx.app, OWNER, DEMO_PASSWORD)).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await login(ctx.app, OWNER, "wrong-password")).statusCode).toBe(401);
    }
  });

  describe("lockouts can't be turned against the owner (Stage 16)", () => {
    const from = (ip: string, password: string, cookies: Record<string, string> = {}) =>
      ctx.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        remoteAddress: ip,
        cookies,
        payload: { email: OWNER, password },
      });
    const deviceCookieOf = (response: Awaited<ReturnType<typeof from>>) =>
      response.cookies.find((c) => c.name === DEVICE_COOKIE)?.value;

    it("one address can't lock the account: attempts it isn't allowed don't count", async () => {
      for (let i = 0; i < 30; i++) await from("203.0.113.50", `wrong-${i}`);
      expect((await from("203.0.113.50", DEMO_PASSWORD)).statusCode).toBe(429); // that address: blocked
      expect((await from("198.51.100.9", DEMO_PASSWORD)).statusCode).toBe(200); // the owner: not
    });

    it("many addresses can trip the account limit, but the owner's known browser still gets in", async () => {
      const earlier = await from("198.51.100.9", DEMO_PASSWORD);
      const device = deviceCookieOf(earlier);
      expect(device).toBeTruthy();

      // A botnet: five tries from each of five addresses = 25 > the account's 20.
      for (let bot = 1; bot <= 5; bot++) {
        for (let i = 0; i < 5; i++) await from(`203.0.113.${bot}`, "wrong-password");
      }
      // A browser that has never signed in to this account is held back…
      expect((await from("198.51.100.77", DEMO_PASSWORD)).statusCode).toBe(429);
      // …a forged "known device" cookie doesn't help…
      expect(
        (await from("198.51.100.77", DEMO_PASSWORD, { [DEVICE_COOKIE]: "forged" })).statusCode,
      ).toBe(429);
      // …but the owner's own browser signs in.
      expect(
        (await from("198.51.100.9", DEMO_PASSWORD, { [DEVICE_COOKIE]: device! })).statusCode,
      ).toBe(200);
    });

    it("a known browser is still limited for wrong passwords from its own address", async () => {
      const device = deviceCookieOf(await from("198.51.100.9", DEMO_PASSWORD))!;
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        statuses.push(
          (await from("198.51.100.9", "wrong", { [DEVICE_COOKIE]: device })).statusCode,
        );
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    });
  });

  it("2FA codes are limited per ACCOUNT: a new sign-in doesn't buy new guesses", async () => {
    // Turn on 2FA for the demo user.
    const first = await login(ctx.app, OWNER, DEMO_PASSWORD);
    const cookies = {
      [SESSION_COOKIE]: first.cookies.find((c) => c.name === SESSION_COOKIE)!.value,
    };
    const { secret } = (
      await ctx.app.inject({ method: "POST", url: "/v1/auth/mfa/totp/setup", cookies })
    ).json();
    await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/mfa/totp/enable",
      cookies,
      payload: { code: code(secret) },
    });

    const pendingSession = async () => {
      const response = await login(ctx.app, OWNER, DEMO_PASSWORD);
      expect(response.json().status).toBe("mfa_required");
      return { [SESSION_COOKIE]: response.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    };
    const guess = (session: Record<string, string>, value: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/v1/auth/login/mfa",
        cookies: session,
        payload: { code: value },
      });

    let session = await pendingSession();
    for (let i = 0; i < 5; i++) {
      expect((await guess(session, "000000")).statusCode).toBe(401);
      session = await pendingSession(); // the attacker signs in again for a "fresh" session
    }
    // Before Stage 15, this new session got five more guesses. Not any more —
    // and even the right code waits until the window passes.
    expect((await guess(session, "000000")).statusCode).toBe(429);
    expect((await guess(session, code(secret))).statusCode).toBe(429);
  });
});
