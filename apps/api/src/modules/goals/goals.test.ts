import { describe, expect, it } from "vitest";
import { OWNER, VIEWER, request, useTestApp } from "../../test/helpers.js";

describe("goals", () => {
  const ctx = useTestApp();
  const base = () => `/v1/households/${ctx.fixtures.householdId}`;
  const as = (
    user: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    payload?: object,
  ) => request(ctx.app, user, { method, url: `${base()}${path}`, ...(payload && { payload }) });

  it("lists goals with a projection from the account's real pace", async () => {
    const { data } = (await as(OWNER, "GET", "/goals?today=2026-06-15")).json();
    expect(data).toHaveLength(1);
    const goal = data[0];
    expect(goal).toMatchObject({ name: "Emergency fund", accountName: "High-Yield Savings" });
    // The demo moves $500 a month into savings and earns $38–55 interest.
    expect(goal.monthlyPaceMinor).toBeGreaterThan(53_800);
    expect(goal.monthlyPaceMinor).toBeLessThan(55_500);
    expect(goal.remainingMinor).toBe(goal.targetMinor - goal.balanceMinor);
    expect(goal.progress).toBeCloseTo(goal.balanceMinor / goal.targetMinor, 5);
    expect(goal.projectedMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(["on_track", "behind"]).toContain(goal.status);
  });

  it("creates, updates and deletes a goal", async () => {
    const accounts = (await as(OWNER, "GET", "/accounts")).json().data;
    const checking = accounts.find((a: { name: string }) => a.name === "Everyday Checking");
    const created = await as(OWNER, "POST", "/goals", {
      name: "  New laptop ",
      accountId: checking.id,
      targetMinor: 100,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "New laptop", status: "reached", progress: 1 });

    const updated = await as(OWNER, "PATCH", `/goals/${created.json().id}`, {
      targetMinor: 1_000_000_000,
      targetDate: "2026-12-01",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).not.toBe("reached");
    expect(updated.json().requiredMonthlyMinor).toBeGreaterThan(0);

    expect((await as(OWNER, "DELETE", `/goals/${created.json().id}`)).statusCode).toBe(204);
    expect((await as(OWNER, "DELETE", `/goals/${created.json().id}`)).statusCode).toBe(404);
  });

  it("rejects bad input", async () => {
    const zero = await as(OWNER, "POST", "/goals", {
      name: "Nothing",
      accountId: "0190f5a0-0000-7000-8000-000000000000",
      targetMinor: 0,
    });
    expect(zero.statusCode).toBe(400);
    const unknownAccount = await as(OWNER, "POST", "/goals", {
      name: "Ghost",
      accountId: "0190f5a0-0000-7000-8000-000000000000",
      targetMinor: 1_000,
    });
    expect(unknownAccount.statusCode).toBe(422);
  });

  it("is read-only for viewers", async () => {
    expect((await as(VIEWER, "GET", "/goals")).statusCode).toBe(200);
    const created = await as(VIEWER, "POST", "/goals", {
      name: "Sneaky",
      accountId: "0190f5a0-0000-7000-8000-000000000000",
      targetMinor: 1_000,
    });
    expect(created.statusCode).toBe(403);
  });
});

describe("recurring report", () => {
  const ctx = useTestApp();
  const url = (today: string) =>
    `/v1/households/${ctx.fixtures.householdId}/reports/recurring?today=${today}`;

  it("finds the demo's bills and income and predicts the next dates", async () => {
    const { series } = (
      await request(ctx.app, OWNER, { method: "GET", url: url("2026-06-15") })
    ).json();
    const by = (text: string) =>
      series.find((s: { description: string }) => s.description.startsWith(text));

    expect(by("Rent")).toMatchObject({
      cadence: "monthly",
      amountMinor: -165_000,
      nextDate: "2026-07-01",
    });
    expect(by("Netflix")).toMatchObject({ cadence: "monthly", nextDate: "2026-07-05" });
    expect(by("Salary")).toMatchObject({ cadence: "twice_monthly", amountMinor: 212_500 });
    expect(by("PG&E")).toMatchObject({ variable: true });
    // Transfers are not bills.
    expect(by("Monthly savings")).toBeUndefined();
    // Sorted by when they're due.
    const dates = series.map((s: { nextDate: string }) => s.nextDate);
    expect(dates).toEqual([...dates].sort());
    expect(dates.every((d: string) => d >= "2026-06-15")).toBe(true);
  });
});
