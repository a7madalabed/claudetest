import { DEMO_PASSWORD, accountTokens, sql } from "@ledgerly/db";
import { describe, expect, it } from "vitest";
import { OWNER, jobRunner, request, useTestApp } from "../../test/helpers.js";

/** The token from the last email to `to` whose subject matches. */
function linkToken(mailer: ReturnType<typeof jobRunner>["mailer"], to: string, subject: RegExp) {
  const email = mailer.sent.filter((m) => m.to === to && subject.test(m.subject)).at(-1);
  expect(email, `an email to ${to} matching ${subject}`).toBeDefined();
  return /token=([\w-]+)/.exec(email!.text)![1]!;
}

describe("password reset", () => {
  const ctx = useTestApp();
  const post = (url: string, payload: object) =>
    request(ctx.app, null, { method: "POST", url, payload });
  const login = (password: string) => post("/v1/auth/login", { email: OWNER, password });
  const NEW_PASSWORD = "a-brand-new-passphrase-2";

  it("emails a single-use link that sets a new password and signs out every device", async () => {
    const jobs = jobRunner(ctx.db);
    expect((await post("/v1/auth/password-reset/request", { email: OWNER })).statusCode).toBe(202);
    await jobs.run();
    const token = linkToken(jobs.mailer, OWNER, /Reset your Ledgerly password/);

    expect(
      (await post("/v1/auth/password-reset", { token, password: NEW_PASSWORD })).statusCode,
    ).toBe(204);
    expect((await login(DEMO_PASSWORD)).statusCode).toBe(401);
    expect((await login(NEW_PASSWORD)).statusCode).toBe(200);

    // The fixture's existing session (another device) was signed out.
    expect((await request(ctx.app, OWNER, { method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    // The owner is told, in case it wasn't them.
    await jobs.run();
    expect(jobs.mailer.sent.map((m) => m.subject)).toContain("Your Ledgerly password was changed");
    // Single use.
    const again = await post("/v1/auth/password-reset", {
      token,
      password: "yet-another-passphrase",
    });
    expect(again.statusCode).toBe(410);
    expect(again.json().code).toBe("link_expired");
  });

  it("gives the same answer for an unknown address, and sends nothing", async () => {
    const jobs = jobRunner(ctx.db);
    const response = await post("/v1/auth/password-reset/request", { email: "nobody@example.com" });
    expect(response.statusCode).toBe(202);
    await jobs.run();
    expect(jobs.mailer.sent).toEqual([]);
  });

  it("only the newest link works, and links expire", async () => {
    const jobs = jobRunner(ctx.db);
    await post("/v1/auth/password-reset/request", { email: OWNER });
    await jobs.run();
    const first = linkToken(jobs.mailer, OWNER, /Reset/);
    await post("/v1/auth/password-reset/request", { email: OWNER });
    await jobs.run();
    const second = linkToken(jobs.mailer, OWNER, /Reset/);

    expect(
      (await post("/v1/auth/password-reset", { token: first, password: NEW_PASSWORD })).statusCode,
    ).toBe(410);
    await ctx.db.update(accountTokens).set({ expiresAt: sql`now() - interval '1 minute'` });
    expect(
      (await post("/v1/auth/password-reset", { token: second, password: NEW_PASSWORD })).statusCode,
    ).toBe(410);
  });

  it("rejects a weak new password", async () => {
    const jobs = jobRunner(ctx.db);
    await post("/v1/auth/password-reset/request", { email: OWNER });
    await jobs.run();
    const token = linkToken(jobs.mailer, OWNER, /Reset/);
    const response = await post("/v1/auth/password-reset", { token, password: "password1234" });
    expect(response.statusCode).toBe(422);
  });

  it("lifts a lockout: the real owner proved who they are", async () => {
    for (let i = 0; i < 5; i++) await login("wrong-password");
    expect((await login(DEMO_PASSWORD)).statusCode).toBe(429);

    const jobs = jobRunner(ctx.db);
    await post("/v1/auth/password-reset/request", { email: OWNER });
    await jobs.run();
    const token = linkToken(jobs.mailer, OWNER, /Reset/);
    await post("/v1/auth/password-reset", { token, password: NEW_PASSWORD });
    expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
  });
});

describe("email verification", () => {
  const ctx = useTestApp();
  const email = "new.person@example.com";

  async function signUp() {
    const response = await request(ctx.app, null, {
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email, password: "purple-monkey-dishwasher", displayName: "New Person" },
    });
    expect(response.statusCode).toBe(201);
    const cookie = response.cookies.find((c) => c.name.endsWith("ledgerly_session"))!;
    return { me: response.json(), cookies: { [cookie.name]: cookie.value } };
  }

  it("sign-up sends a confirmation link; it works once", async () => {
    const jobs = jobRunner(ctx.db);
    const { me, cookies } = await signUp();
    expect(me.emailVerified).toBe(false);
    await jobs.run();
    const token = linkToken(jobs.mailer, email, /Confirm your email/);

    const verify = () =>
      request(ctx.app, null, { method: "POST", url: "/v1/auth/verify-email", payload: { token } });
    expect((await verify()).statusCode).toBe(204);
    expect((await verify()).statusCode).toBe(410);
    const after = await ctx.app.inject({ method: "GET", url: "/v1/me", cookies });
    expect(after.json().emailVerified).toBe(true);

    const resend = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/verify-email/resend",
      cookies,
    });
    expect(resend.statusCode).toBe(409);
  });

  it("joining a household needs a confirmed email", async () => {
    const invite = await request(ctx.app, OWNER, {
      method: "POST",
      url: `/v1/households/${ctx.fixtures.householdId}/invitations`,
      payload: { email, role: "editor" },
    });
    expect(invite.statusCode).toBe(201);
    const inviteToken = new URL(invite.json().inviteUrl).pathname.split("/").at(-1)!;

    const jobs = jobRunner(ctx.db);
    const { cookies } = await signUp();
    const accept = () =>
      ctx.app.inject({ method: "POST", url: `/v1/invitations/${inviteToken}/accept`, cookies });

    const refused = await accept();
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe("email_not_verified");

    await jobs.run();
    const token = linkToken(jobs.mailer, email, /Confirm your email/);
    await request(ctx.app, null, {
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token },
    });
    expect((await accept()).statusCode).toBe(200);
  });
});
