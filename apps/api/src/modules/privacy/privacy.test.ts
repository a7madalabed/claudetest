import {
  DEMO_PASSWORD,
  count,
  eq,
  householdMembers,
  households,
  transactions,
  users,
} from "@ledgerly/db";
import { describe, expect, it } from "vitest";
import { OUTSIDER, OWNER, VIEWER, jobRunner, request, useTestApp } from "../../test/helpers.js";

describe("data export", () => {
  const ctx = useTestApp();

  it("downloads everything the user can see — other members by name only", async () => {
    const response = await request(ctx.app, OWNER, { method: "GET", url: "/v1/me/export" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toMatch(
      /attachment; filename="ledgerly-export-/,
    );

    const data = response.json();
    expect(data.user.email).toBe(OWNER);
    const [household] = data.households;
    const [total] = await ctx.db
      .select({ n: count() })
      .from(transactions)
      .where(eq(transactions.householdId, ctx.fixtures.householdId));
    expect(household.transactions).toHaveLength(total!.n);
    expect(household.members).toContainEqual({ name: "Vee Viewer", role: "viewer" });
    // Other people's email addresses are THEIR personal data.
    expect(response.body).not.toContain(VIEWER);
    // Nothing secret leaks into an export.
    expect(response.body).not.toMatch(/argon2|password_hash|passwordHash|totp_secret/i);
  });
});

describe("account deletion", () => {
  const ctx = useTestApp();
  const del = (who: string, body: object) =>
    request(ctx.app, who, { method: "DELETE", url: "/v1/me", payload: body });
  const userExists = async (email: string) =>
    (await ctx.db.select().from(users).where(eq(users.email, email))).length === 1;

  it("needs the password", async () => {
    const response = await del(OUTSIDER, { password: "not-it" });
    expect(response.statusCode).toBe(422);
    expect(await userExists(OUTSIDER)).toBe(true);
  });

  it("refuses while you're the only owner of a household others use", async () => {
    const response = await del(OWNER, { password: DEMO_PASSWORD });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "sole_owner" });
    expect(response.json().detail).toContain("Make one of them an owner");
    expect(await userExists(OWNER)).toBe(true);
  });

  it("deletes the account, its solo households and their data, and says goodbye by email", async () => {
    // The outsider owns a household of their own (and the test signs them in via a session).
    await ctx.db
      .update(users)
      .set({
        passwordHash: (await ctx.db.select().from(users).where(eq(users.email, OWNER)))[0]!
          .passwordHash,
      })
      .where(eq(users.email, OUTSIDER));
    const [membership] = await ctx.db
      .select({ householdId: householdMembers.householdId })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(eq(users.email, OUTSIDER));

    const response = await del(OUTSIDER, { password: DEMO_PASSWORD });
    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((c) => c.name.endsWith("ledgerly_session"))?.maxAge).toBe(0);

    expect(await userExists(OUTSIDER)).toBe(false);
    expect(
      await ctx.db.select().from(households).where(eq(households.id, membership!.householdId)),
    ).toEqual([]);
    expect((await request(ctx.app, OUTSIDER, { method: "GET", url: "/v1/me" })).statusCode).toBe(
      401,
    );

    const jobs = jobRunner(ctx.db);
    await jobs.run();
    expect(jobs.mailer.sent).toContainEqual(
      expect.objectContaining({ to: OUTSIDER, subject: "Your Ledgerly account was deleted" }),
    );
  });

  it("leaving a shared household keeps it, and its data, for everyone else", async () => {
    await ctx.db
      .update(users)
      .set({
        passwordHash: (await ctx.db.select().from(users).where(eq(users.email, OWNER)))[0]!
          .passwordHash,
      })
      .where(eq(users.email, VIEWER));
    const before = await ctx.db
      .select({ n: count() })
      .from(transactions)
      .where(eq(transactions.householdId, ctx.fixtures.householdId));

    expect((await del(VIEWER, { password: DEMO_PASSWORD })).statusCode).toBe(204);
    const after = await ctx.db
      .select({ n: count() })
      .from(transactions)
      .where(eq(transactions.householdId, ctx.fixtures.householdId));
    expect(after).toEqual(before);
    const me = await request(ctx.app, OWNER, { method: "GET", url: "/v1/me" });
    expect(me.json().households).toHaveLength(1);
  });
});
