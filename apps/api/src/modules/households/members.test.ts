import { describe, expect, it } from "vitest";
import { OUTSIDER, OWNER, VIEWER, request, useTestApp } from "../../test/helpers.js";

describe("members", () => {
  const ctx = useTestApp();
  const base = () => `/v1/households/${ctx.fixtures.householdId}`;
  const as = (
    user: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    payload?: object,
  ) => request(ctx.app, user, { method, url: `${base()}${path}`, ...(payload && { payload }) });
  const list = async (user = OWNER) => (await as(user, "GET", "/members")).json().data;
  const idOf = async (email: string) =>
    (await list()).find((m: { email: string }) => m.email === email).userId;

  it("lists everyone with their role, marking you", async () => {
    const members = await list();
    expect(members.map((m: { email: string; role: string }) => `${m.email}:${m.role}`)).toEqual([
      "demo@ledgerly.app:owner",
      "jamie@ledgerly.app:editor",
      `${VIEWER}:viewer`,
    ]);
    expect(members.find((m: { isYou: boolean }) => m.isYou).email).toBe(OWNER);
    expect(await list(VIEWER)).toHaveLength(3); // viewers can see who's here
  });

  it("lets owners change roles, and only owners", async () => {
    const viewer = await idOf(VIEWER);
    expect((await as(VIEWER, "PATCH", `/members/${viewer}`, { role: "owner" })).statusCode).toBe(
      403,
    );
    expect((await as(OWNER, "PATCH", `/members/${viewer}`, { role: "editor" })).statusCode).toBe(
      204,
    );
    expect((await list()).find((m: { userId: string }) => m.userId === viewer).role).toBe("editor");
  });

  it("never leaves a household without an owner", async () => {
    const me = await idOf(OWNER);
    const demote = await as(OWNER, "PATCH", `/members/${me}`, { role: "editor" });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().code).toBe("last_owner");
    expect((await as(OWNER, "DELETE", `/members/${me}`)).json().code).toBe("last_owner");

    // With a second owner, stepping down is fine.
    await as(OWNER, "PATCH", `/members/${await idOf("jamie@ledgerly.app")}`, { role: "owner" });
    expect((await as(OWNER, "PATCH", `/members/${me}`, { role: "editor" })).statusCode).toBe(204);
  });

  it("removes members (owners) — and they lose access immediately", async () => {
    const viewer = await idOf(VIEWER);
    expect((await as(OWNER, "DELETE", `/members/${viewer}`)).statusCode).toBe(204);
    expect((await as(VIEWER, "GET", "/members")).statusCode).toBe(404);
  });

  it("lets anyone leave, but not remove others", async () => {
    const jamie = await idOf("jamie@ledgerly.app");
    expect((await as(VIEWER, "DELETE", `/members/${jamie}`)).statusCode).toBe(403);
    expect((await as(VIEWER, "DELETE", `/members/${await idOf(VIEWER)}`)).statusCode).toBe(204);
    expect(await list()).toHaveLength(2);
  });

  it("lets owners rename the household and set its time zone", async () => {
    expect(
      (await as(OWNER, "PATCH", "", { name: "Casa Demo", timeZone: "Europe/Lisbon" })).statusCode,
    ).toBe(204);
    const me = (await request(ctx.app, OWNER, { method: "GET", url: "/v1/me" })).json();
    expect(me.households[0]).toMatchObject({ name: "Casa Demo", timeZone: "Europe/Lisbon" });
    expect((await as(OWNER, "PATCH", "", { timeZone: "Mars/Olympus" })).statusCode).toBe(400);
    expect((await as(VIEWER, "PATCH", "", { name: "Mine now" })).statusCode).toBe(403);
  });

  it("creates new households owned by their creator", async () => {
    const created = await request(ctx.app, OUTSIDER, {
      method: "POST",
      url: "/v1/households",
      payload: { name: "Side Business", timeZone: "America/New_York" },
    });
    expect(created.statusCode).toBe(201);
    const names = created
      .json()
      .households.map((h: { name: string; role: string }) => `${h.name}:${h.role}`);
    expect(names).toContain("Side Business:owner");

    // Ready to use: the same starter categories a sign-up gets (Stage 16).
    const household = created
      .json()
      .households.find((h: { name: string }) => h.name === "Side Business");
    const categories = await request(ctx.app, OUTSIDER, {
      method: "GET",
      url: `/v1/households/${household.id}/categories`,
    });
    expect(categories.json().data.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(["Salary", "Groceries", "Rent", "Transport"]),
    );
  });
});
