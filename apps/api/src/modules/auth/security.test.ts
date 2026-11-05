import { DEMO_PASSWORD, desc, sessions } from "@ledgerly/db";
import { describe, expect, it } from "vitest";
import { OWNER, request, useTestApp } from "../../test/helpers.js";

describe("CSRF protection", () => {
  const ctx = useTestApp();
  const post = (headers: Record<string, string>) =>
    request(ctx.app, OWNER, {
      method: "POST",
      url: `/v1/households/${ctx.fixtures.householdId}/accounts`,
      payload: { name: "CSRF test", type: "cash", currency: "USD" },
      headers,
    });

  it("blocks state-changing requests from another site's Origin", async () => {
    const response = await post({ origin: "https://evil.example" });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("csrf_rejected");
  });

  it("blocks requests the browser labels cross-site (Fetch Metadata)", async () => {
    expect((await post({ "sec-fetch-site": "cross-site" })).statusCode).toBe(403);
  });

  it("allows our own front end and same-site requests", async () => {
    expect(
      (await post({ origin: "http://localhost:3000", "sec-fetch-site": "same-site" })).statusCode,
    ).toBe(201);
  });

  it("refuses non-JSON bodies (what an HTML form would send)", async () => {
    const response = await request(ctx.app, OWNER, {
      method: "POST",
      url: `/v1/households/${ctx.fixtures.householdId}/accounts`,
      headers: { "content-type": "text/plain" },
      payload: '{"name":"form","type":"cash","currency":"USD"}',
    });
    expect(response.statusCode).toBe(415);
  });

  it("never applies to safe (read-only) requests", async () => {
    const response = await request(ctx.app, OWNER, {
      method: "GET",
      url: "/v1/me",
      headers: { origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(200); // CORS stops evil.example from READING it
  });
});

describe("rate limiting", () => {
  const ctx = useTestApp({ RATE_LIMIT_ENABLED: "true" });

  it("locks out repeated sign-in attempts for one email, with Retry-After", async () => {
    const attempt = (password: string) =>
      request(ctx.app, null, {
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: OWNER, password },
      });

    for (let i = 0; i < 5; i++) expect((await attempt("wrong-password")).statusCode).toBe(401);

    const blocked = await attempt(DEMO_PASSWORD); // even the RIGHT password is refused now
    expect(blocked.statusCode).toBe(429);
    // Database-backed since Stage 15 (modules/auth/throttle.ts).
    expect(blocked.json()).toMatchObject({ code: "too_many_attempts", status: 429 });
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    // A different account from the same IP isn't affected.
    const other = await request(ctx.app, null, {
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "someone@example.com", password: "x" },
    });
    expect(other.statusCode).toBe(401);
  });
});

describe("client IP behind proxies", () => {
  const loginFrom = (app: Parameters<typeof request>[0], forwardedFor: string) =>
    app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-forwarded-for": forwardedFor },
      payload: { email: OWNER, password: DEMO_PASSWORD },
    });

  describe("with TRUST_PROXY=1 (one proxy: the Next.js /api rewrite)", () => {
    const ctx = useTestApp({ TRUST_PROXY: "1" });
    it("records the address the proxy reports", async () => {
      await loginFrom(ctx.app, "203.0.113.7");
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .orderBy(desc(sessions.createdAt))
        .limit(1);
      expect(session!.ipAddress).toBe("203.0.113.7");
    });
    it("ignores addresses a client forged further left in the chain", async () => {
      await loginFrom(ctx.app, "6.6.6.6, 203.0.113.7");
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .orderBy(desc(sessions.createdAt))
        .limit(1);
      expect(session!.ipAddress).toBe("203.0.113.7");
    });
  });

  describe("with TRUST_PROXY=false", () => {
    const ctx = useTestApp({ TRUST_PROXY: "false" });
    it("ignores X-Forwarded-For entirely", async () => {
      await loginFrom(ctx.app, "203.0.113.7");
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .orderBy(desc(sessions.createdAt))
        .limit(1);
      expect(session!.ipAddress).toBe("127.0.0.1");
    });
  });
});
