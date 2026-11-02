import { eq, householdInvitations, jobs, sql } from "@ledgerly/db";
import { describe, expect, it } from "vitest";
import { sha256 } from "../../auth/tokens.js";
import { OUTSIDER, OWNER, VIEWER, jobRunner, request, useTestApp } from "../../test/helpers.js";

describe("invitations", () => {
  const ctx = useTestApp();
  const base = () => `/v1/households/${ctx.fixtures.householdId}`;
  const invite = (email = OUTSIDER, role = "editor", user = OWNER) =>
    request(ctx.app, user, {
      method: "POST",
      url: `${base()}/invitations`,
      payload: { email, role },
    });
  const tokenOf = (url: string) => url.split("/invite/")[1]!;
  const preview = (token: string) =>
    request(ctx.app, null, { method: "GET", url: `/v1/invitations/${token}` });
  const accept = (token: string, user = OUTSIDER) =>
    request(ctx.app, user, { method: "POST", url: `/v1/invitations/${token}/accept` });

  it("creates a link, stores only its hash, and emails it (token encrypted in the job)", async () => {
    const response = await invite("Outsider@Example.com");
    expect(response.statusCode).toBe(201);
    const { invitation, inviteUrl } = response.json();
    expect(invitation).toMatchObject({
      email: OUTSIDER,
      role: "editor",
      invitedByName: "Alex Demo",
    });
    const token = tokenOf(inviteUrl);

    const [stored] = await ctx.db.select().from(householdInvitations);
    expect(stored!.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    const [job] = await ctx.db.select().from(jobs).where(eq(jobs.name, "invitation.send"));
    expect(JSON.stringify(job!.payload)).not.toContain(token); // encrypted at rest

    const runner = jobRunner(ctx.db);
    await runner.run();
    const email = runner.mailer.sent.find((m) => m.to === OUTSIDER)!;
    expect(email.subject).toBe("Alex Demo invited you to Alex's Household on Ledgerly");
    expect(email.text).toContain(inviteUrl);
  });

  it("previews without signing in, then joins the household on accept", async () => {
    const token = tokenOf((await invite()).json().inviteUrl);
    expect((await preview(token)).json()).toEqual({
      householdName: "Alex's Household",
      invitedByName: "Alex Demo",
      email: OUTSIDER,
      role: "editor",
      status: "pending",
    });
    expect(
      (await request(ctx.app, OUTSIDER, { method: "GET", url: `${base()}/members` })).statusCode,
    ).toBe(404);

    const accepted = await accept(token);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().householdId).toBe(ctx.fixtures.householdId);
    expect(
      (await request(ctx.app, OUTSIDER, { method: "GET", url: `${base()}/members` })).statusCode,
    ).toBe(200);
    // A link works once.
    expect((await accept(token)).json().code).toBe("invitation_accepted");
    expect((await preview(token)).json().status).toBe("accepted");
  });

  it("only works for the invited email address", async () => {
    const token = tokenOf((await invite()).json().inviteUrl);
    const wrong = await accept(token, VIEWER);
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().code).toBe("invitation_email_mismatch");
  });

  it("can be revoked, declined, or expire — and then it's dead", async () => {
    const revokedToken = tokenOf((await invite()).json().inviteUrl);
    const [row] = await ctx.db.select().from(householdInvitations);
    await request(ctx.app, OWNER, { method: "DELETE", url: `${base()}/invitations/${row!.id}` });
    expect((await accept(revokedToken)).statusCode).toBe(410);

    const declinedToken = tokenOf((await invite()).json().inviteUrl);
    const declined = await request(ctx.app, OUTSIDER, {
      method: "POST",
      url: `/v1/invitations/${declinedToken}/decline`,
    });
    expect(declined.statusCode).toBe(204);
    expect((await preview(declinedToken)).json().status).toBe("declined");

    const expiredToken = tokenOf((await invite()).json().inviteUrl);
    await ctx.db
      .update(householdInvitations)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(householdInvitations.tokenHash, sha256(expiredToken)));
    expect((await accept(expiredToken)).json().code).toBe("invitation_expired");
    // An expired invitation is replaced by a fresh one rather than blocking.
    expect((await invite()).statusCode).toBe(201);
  });

  it("refuses duplicates and existing members", async () => {
    await invite();
    expect((await invite()).json().code).toBe("already_invited");
    expect((await invite(VIEWER)).json().code).toBe("already_member");
  });

  it("is managed by owners only", async () => {
    expect((await invite(OUTSIDER, "editor", VIEWER)).statusCode).toBe(403);
    expect(
      (await request(ctx.app, VIEWER, { method: "GET", url: `${base()}/invitations` })).statusCode,
    ).toBe(403);
    expect((await invite(OUTSIDER, "owner")).statusCode).toBe(400); // owners are promoted, not invited
  });

  it("answers 404 for unknown tokens", async () => {
    expect((await preview("x".repeat(43))).statusCode).toBe(404);
  });
});
