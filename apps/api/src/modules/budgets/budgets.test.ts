import { budgets, sql } from "@ledgerly/db";
import { describe, expect, it } from "vitest";
import { OWNER, OUTSIDER, VIEWER, request, useTestApp } from "../../test/helpers.js";

/*
 * The fixture data is the demo household seeded "as of" 2026-06-15, with six
 * budgets starting January 2026. Dining out was raised from $200 to $250 in April.
 */
describe("budgets", () => {
  const ctx = useTestApp();
  const base = () => `/v1/households/${ctx.fixtures.householdId}`;
  const as = (
    user: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    payload?: object,
  ) => request(ctx.app, user, { method, url: `${base()}${path}`, ...(payload && { payload }) });
  const month = async (m: string) => (await as(OWNER, "GET", `/budgets?month=${m}`)).json();
  const budget = async (m: string, name: string) =>
    (await month(m)).budgets.find((b: { name: string }) => b.name === name);
  const category = async (name: string) =>
    (await as(OWNER, "GET", "/categories"))
      .json()
      .data.find((c: { name: string }) => c.name === name);

  it("returns every budget for a month with consistent arithmetic", async () => {
    const view = await month("2026-06");
    expect(view.budgets).toHaveLength(6);
    for (const b of view.budgets) {
      expect(b.availableMinor).toBe(b.amountMinor + b.rolloverMinor);
      expect(b.remainingMinor).toBe(b.availableMinor - b.spentMinor);
      expect(["ok", "warning", "over"]).toContain(b.status);
    }
    expect(view.totals.spentMinor).toBe(
      view.budgets.reduce((sum: number, b: { spentMinor: number }) => sum + b.spentMinor, 0),
    );
    expect(view.unbudgetedSpendingMinor).toBeGreaterThan(0); // rent, transit, internet…
  });

  it("sorts the most urgent budgets first", async () => {
    const rank = { over: 2, warning: 1, ok: 0 } as const;
    const statuses: Array<keyof typeof rank> = (await month("2026-06")).budgets.map(
      (b: { status: keyof typeof rank }) => b.status,
    );
    const ranks = statuses.map((s) => rank[s]);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  it("applies amount changes from their effective month only", async () => {
    expect((await budget("2026-03", "Dining out")).amountMinor).toBe(20_000);
    expect((await budget("2026-04", "Dining out")).amountMinor).toBe(25_000);
    expect((await budget("2026-06", "Dining out")).amountMinor).toBe(25_000);
  });

  it("carries leftovers forward for rollover budgets", async () => {
    const jan = await budget("2026-01", "Groceries");
    const feb = await budget("2026-02", "Groceries");
    expect(jan.rolloverMinor).toBe(0);
    expect(feb.rolloverMinor).toBe(jan.remainingMinor);
    expect((await budget("2026-02", "Utilities")).rolloverMinor).toBe(0); // no rollover
  });

  it("counts spending net of refunds, and subcategories toward their parent's budget", async () => {
    const before = await budget("2026-06", "Entertainment");
    const events = await category("Events"); // a child of Entertainment
    const accounts = (await as(OWNER, "GET", "/accounts")).json().data;
    const add = (amountMinor: number, description: string) =>
      as(OWNER, "POST", "/transactions", {
        accountId: accounts[0].id,
        categoryId: events.id,
        amountMinor,
        occurredOn: "2026-06-14",
        description,
      });
    expect((await add(-6_000, "Concert")).statusCode).toBe(201);
    expect((await add(1_500, "Partial refund")).statusCode).toBe(201);
    const after = await budget("2026-06", "Entertainment");
    expect(after.spentMinor - before.spentMinor).toBe(4_500);
  });

  it("has nothing for months before a budget starts", async () => {
    expect((await month("2025-12")).budgets).toEqual([]);
  });

  it("creates, edits from a month onward, and deletes", async () => {
    const travel = await category("Travel");
    const created = await as(OWNER, "POST", "/budgets", {
      categoryId: travel.id,
      amountMinor: 30_000,
      startMonth: "2026-05",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "Travel", amountMinor: 30_000, rollover: false });
    const id = created.json().id;

    const edited = await as(OWNER, "PATCH", `/budgets/${id}`, {
      amountMinor: 45_000,
      effectiveMonth: "2026-06",
      rollover: true,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ amountMinor: 45_000, rollover: true });
    expect((await budget("2026-05", "Travel")).amountMinor).toBe(30_000); // history kept

    expect((await as(OWNER, "DELETE", `/budgets/${id}`)).statusCode).toBe(204);
    expect(await budget("2026-06", "Travel")).toBeUndefined();
  });

  it("requires effectiveMonth with a new amount", async () => {
    const { id } = await budget("2026-06", "Coffee");
    const response = await as(OWNER, "PATCH", `/budgets/${id}`, { amountMinor: 1_000 });
    expect(response.statusCode).toBe(400);
  });

  it("409 for a second budget on the same category", async () => {
    const groceries = await category("Groceries");
    const response = await as(OWNER, "POST", "/budgets", {
      categoryId: groceries.id,
      amountMinor: 1_000,
      startMonth: "2026-06",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("budget_exists");
  });

  it("a parent and its child can't both get budgets, even at the same moment (Stage 17)", async () => {
    // The overlap rule used to be "check, then insert": a request arriving
    // while another was between its check and its commit passed the check too,
    // and the child's spending counted twice. Here the first request is held
    // open mid-way, deterministically, as a transaction of our own.
    const parent = (
      await as(OWNER, "POST", "/categories", { name: "Pets", kind: "expense" })
    ).json();
    const child = (
      await as(OWNER, "POST", "/categories", { name: "Vet", kind: "expense", parentId: parent.id })
    ).json();
    const householdId = ctx.fixtures.householdId;

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = ctx.db.transaction(async (tx) => {
      // What createBudget does: lock the household's row, then check and insert.
      await tx.execute(sql`select 1 from households where id = ${householdId} for no key update`);
      await tx
        .insert(budgets)
        .values({ householdId, categoryId: parent.id, startMonth: "2026-06-01" });
      await held; // …and hasn't committed yet
    });
    const second = as(OWNER, "POST", "/budgets", {
      categoryId: child.id,
      startMonth: "2026-06",
      amountMinor: 10_000,
    });
    await new Promise((r) => setTimeout(r, 300)); // the second request reaches its check
    release();
    await first;
    const response = await second;
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("budget_overlaps");
  });

  it("422 for income categories and for overlapping parent/child budgets", async () => {
    const salary = await category("Salary");
    const income = await as(OWNER, "POST", "/budgets", {
      categoryId: salary.id,
      amountMinor: 1_000,
      startMonth: "2026-06",
    });
    expect(income.json().code).toBe("budget_category_not_expense");

    // Food's children (Groceries, Coffee, Dining out) are already budgeted.
    const food = await category("Food");
    const overlap = await as(OWNER, "POST", "/budgets", {
      categoryId: food.id,
      amountMinor: 100_000,
      startMonth: "2026-06",
    });
    expect(overlap.statusCode).toBe(422);
    expect(overlap.json().code).toBe("budget_overlaps");
  });

  it("lets viewers read but not change budgets, and hides them from outsiders", async () => {
    expect((await as(VIEWER, "GET", "/budgets?month=2026-06")).statusCode).toBe(200);
    const { id } = await budget("2026-06", "Coffee");
    expect((await as(VIEWER, "DELETE", `/budgets/${id}`)).statusCode).toBe(403);
    expect((await as(OUTSIDER, "GET", "/budgets?month=2026-06")).statusCode).toBe(404);
  });

  it("validates the month format", async () => {
    expect((await as(OWNER, "GET", "/budgets?month=2026-13")).statusCode).toBe(400);
    expect((await as(OWNER, "GET", "/budgets")).statusCode).toBe(400);
  });
});
