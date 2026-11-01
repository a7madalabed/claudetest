import { DEMO_PASSWORD } from "@ledgerly/db";
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

    for (let i = 0; i < 10; i++) expect((await attempt("wrong-password")).statusCode).toBe(401);

    const blocked = await attempt(DEMO_PASSWORD); // even the RIGHT password is refused now
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: "rate_limited", status: 429 });
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
