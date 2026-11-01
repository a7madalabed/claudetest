import { describe, expect, it } from "vitest";
import { OUTSIDER, OWNER, VIEWER, request, useTestApp } from "../../test/helpers.js";

describe("authentication & authorization", () => {
  const ctx = useTestApp();
  const url = (path = "") => `/v1/households/${ctx.fixtures.householdId}${path}`;

  it("401 without credentials", async () => {
    const response = await request(ctx.app, null, { method: "GET", url: "/v1/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("unauthorized");
  });

  it("401 for an unknown user", async () => {
    const response = await request(ctx.app, "nobody@example.com", {
      method: "GET",
      url: url("/accounts"),
    });
    expect(response.statusCode).toBe(401);
  });

  it("GET /v1/me lists my households and my role in each", async () => {
    const response = await request(ctx.app, VIEWER, { method: "GET", url: "/v1/me" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      email: VIEWER,
      households: [{ id: ctx.fixtures.householdId, role: "viewer", baseCurrency: "USD" }],
    });
  });

  it("returns 404 (not 403) for households you don't belong to — existence isn't revealed", async () => {
    const response = await request(ctx.app, OUTSIDER, { method: "GET", url: url("/transactions") });
    expect(response.statusCode).toBe(404);
    const garbage = await request(ctx.app, OUTSIDER, {
      method: "GET",
      url: "/v1/households/not-a-uuid/accounts",
    });
    expect(garbage.statusCode).toBe(404);
  });

  it("viewers can read but not write", async () => {
    expect(
      (await request(ctx.app, VIEWER, { method: "GET", url: url("/accounts") })).statusCode,
    ).toBe(200);
    const write = await request(ctx.app, VIEWER, {
      method: "POST",
      url: url("/accounts"),
      payload: { name: "Sneaky", type: "cash", currency: "USD" },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json()).toMatchObject({ code: "forbidden", status: 403 });
  });

  it("authorization runs before validation (no info leak to outsiders)", async () => {
    const response = await request(ctx.app, OUTSIDER, {
      method: "POST",
      url: url("/accounts"),
      payload: { bad: true },
    });
    expect(response.statusCode).toBe(404);
  });

  it("owners can read the household", async () => {
    const response = await request(ctx.app, OWNER, { method: "GET", url: url() });
    expect(response.json()).toMatchObject({ name: "Alex's Household", role: "owner" });
  });
});
