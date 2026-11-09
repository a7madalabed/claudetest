import { describe, expect, it } from "vitest";
import { OWNER, VIEWER, request, useTestApp } from "../../test/helpers.js";

describe("reports", () => {
  const ctx = useTestApp();
  const get = (path: string) =>
    request(ctx.app, OWNER, {
      method: "GET",
      url: `/v1/households/${ctx.fixtures.householdId}/reports${path}`,
    });

  it("cashflow: one row per month with net = income − spending", async () => {
    const response = await get("/cashflow?from=2026-01-01&to=2026-07-01");
    expect(response.statusCode).toBe(200);
    const { months } = response.json();
    expect(months.map((m: { month: string }) => m.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    for (const month of months) {
      expect(month.netMinor).toBe(month.incomeMinor - month.spendingMinor);
      expect(month.incomeMinor).toBeGreaterThanOrEqual(425_000); // two salaries a month
    }
  });

  it("spending by category: shares add up to 100%", async () => {
    const { totalMinor, categories } = (
      await get("/spending-by-category?from=2026-05-01&to=2026-06-01")
    ).json();
    expect(categories[0].name).toBe("Housing"); // rent dominates
    expect(
      categories.reduce((sum: number, c: { spendingMinor: number }) => sum + c.spendingMinor, 0),
    ).toBe(totalMinor);
    expect(categories.reduce((sum: number, c: { share: number }) => sum + c.share, 0)).toBeCloseTo(
      1,
      3,
    );
  });

  it("validates the date range", async () => {
    const response = await get("/cashflow?from=2026-06-01&to=2026-01-01");
    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0].path).toBe("querystring.to");
  });

  it("net worth: one point per month, ending at the sum of today's account balances", async () => {
    const { points, currency } = (await get("/net-worth?from=2025-07-01&to=2026-07-01")).json();
    expect(currency).toBe("USD");
    expect(points).toHaveLength(12);
    const accounts = (
      await request(ctx.app, OWNER, {
        method: "GET",
        url: `/v1/households/${ctx.fixtures.householdId}/accounts`,
      })
    ).json().data;
    const total = accounts.reduce(
      (sum: number, a: { balanceMinor: number }) => sum + a.balanceMinor,
      0,
    );
    expect(points.at(-1).balanceMinor).toBe(total); // seed data ends on 2026-06-15
  });

  it("daily cash flow adds up to the monthly report", async () => {
    const { days } = (await get("/daily-cashflow?from=2026-05-01&to=2026-06-01")).json();
    const { months } = (await get("/cashflow?from=2026-05-01&to=2026-06-01")).json();
    const sum = (key: "incomeMinor" | "spendingMinor") =>
      days.reduce((total: number, d: Record<string, number>) => total + d[key]!, 0);
    expect(sum("spendingMinor")).toBe(months[0].spendingMinor);
    expect(sum("incomeMinor")).toBe(months[0].incomeMinor);
  });

  it("drills into one category's subcategories", async () => {
    const top = (await get("/spending-by-category?from=2026-05-01&to=2026-06-01")).json();
    const food = top.categories.find((c: { name: string }) => c.name === "Food");
    const drill = (
      await get(`/spending-by-category?from=2026-05-01&to=2026-06-01&parentId=${food.categoryId}`)
    ).json();
    expect(drill.totalMinor).toBe(food.spendingMinor);
    expect(drill.categories.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(["Groceries", "Coffee"]),
    );
  });
});

describe("dashboard layout", () => {
  const ctx = useTestApp();
  const url = () => `/v1/households/${ctx.fixtures.householdId}/dashboard`;

  it("starts with the default layout, then remembers a saved one per user", async () => {
    const initial = (await request(ctx.app, OWNER, { method: "GET", url: url() })).json();
    expect(initial.widgets[0]).toBe("cashflow");

    const reordered = [
      "net-worth",
      "cashflow",
      "spending-by-category",
      "accounts",
      "recent-activity",
      "budgets",
    ];
    const saved = await request(ctx.app, OWNER, {
      method: "PUT",
      url: url(),
      payload: { widgets: reordered },
    });
    expect(saved.statusCode).toBe(200);
    expect((await request(ctx.app, OWNER, { method: "GET", url: url() })).json().widgets).toEqual(
      reordered,
    );
    // Another member's dashboard is untouched.
    expect((await request(ctx.app, VIEWER, { method: "GET", url: url() })).json().widgets[0]).toBe(
      "cashflow",
    );
  });

  it("lets viewers arrange their OWN dashboard (it's a preference, not household data)", async () => {
    const response = await request(ctx.app, VIEWER, {
      method: "PUT",
      url: url(),
      payload: { widgets: ["accounts"] },
    });
    expect(response.statusCode).toBe(200);
  });

  it("appends widgets missing from an older saved layout", async () => {
    await request(ctx.app, OWNER, {
      method: "PUT",
      url: url(),
      payload: { widgets: ["accounts", "cashflow"] },
    });
    const { widgets } = (await request(ctx.app, OWNER, { method: "GET", url: url() })).json();
    expect(widgets.slice(0, 2)).toEqual(["accounts", "cashflow"]);
    expect(widgets).toHaveLength(6);
    expect(widgets.at(-1)).toBe("budgets");
  });

  it("rejects unknown and duplicate widgets", async () => {
    const unknown = await request(ctx.app, OWNER, {
      method: "PUT",
      url: url(),
      payload: { widgets: ["crypto-casino"] },
    });
    expect(unknown.statusCode).toBe(400);
    const dupes = await request(ctx.app, OWNER, {
      method: "PUT",
      url: url(),
      payload: { widgets: ["accounts", "accounts"] },
    });
    expect(dupes.statusCode).toBe(400);
  });
});

/*
 * The dashboard's month statement (Stage 19). Its four lines used to come from
 * three different calculations, so with a bill dated tomorrow, or an archived
 * account, the sum didn't add up and a made-up "adjusted" line filled the gap.
 * Now one query answers all of it, so the arithmetic holds by construction.
 */
describe("month statement", () => {
  const ctx = useTestApp();
  const as = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    request(ctx.app, OWNER, { method, url, ...(payload && { payload }) });

  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const today = new Date();
  const todayIso = iso(today);
  const monthStart = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const lastMonthDay = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
  const tomorrow = iso(new Date(today.getTime() + 86_400_000));

  async function newHousehold() {
    const created = await as("POST", "/v1/households", {
      name: `Statement ${Math.random()}`,
      timeZone: "UTC",
    });
    const households = created.json().households as Array<{ id: string; name: string }>;
    return households.find((h) => h.name.startsWith("Statement"))!.id;
  }

  it("adds up with a loan, an archived account, a transfer and a bill dated tomorrow", async () => {
    const base = `/v1/households/${await newHousehold()}`;
    const account = async (name: string, type: string, openingBalanceMinor: number) =>
      (await as("POST", `${base}/accounts`, { name, type, openingBalanceMinor })).json()
        .id as string;
    const checking = await account("Checking", "checking", 100_000);
    const savings = await account("Old savings", "savings", 500_000);
    await account("Mortgage", "loan", -2_000_000);
    const add = (accountId: string, amountMinor: number, occurredOn: string, description: string) =>
      as("POST", `${base}/transactions`, { accountId, amountMinor, occurredOn, description });

    await add(checking, 300_000, lastMonthDay, "Old salary");
    await add(savings, 1_000, lastMonthDay, "Interest");
    await add(checking, 200_000, todayIso, "Salary");
    await add(checking, -5_000, todayIso, "Coffee");
    await add(checking, -150_000, tomorrow, "Rent, dated tomorrow");
    await as("POST", `${base}/transfers`, {
      fromAccountId: checking,
      toAccountId: savings,
      amountMinor: 40_000,
      occurredOn: todayIso,
    });
    await as("PATCH", `${base}/accounts/${savings}`, { archived: true });

    const response = await as("GET", `${base}/reports/month-statement`);
    expect(response.statusCode).toBe(200);
    const statement = response.json();

    expect(statement).toEqual({
      month: monthStart.slice(0, 7),
      currency: "USD",
      // Opening balances (100,000 + 500,000 − 2,000,000, the loan counts) plus last month's 301,000.
      broughtForwardMinor: -1_099_000,
      receivedMinor: 200_000, // the transfer isn't income
      spentMinor: 5_000, // …nor spending; and tomorrow's rent hasn't happened yet
      // Today's balance: tomorrow's rent is left out, the archived account is still counted.
      netWorthMinor: -904_000,
    });
    // The page's own claim, as arithmetic.
    expect(statement.broughtForwardMinor + statement.receivedMinor - statement.spentMinor).toBe(
      statement.netWorthMinor,
    );
  });

  it("a brand-new household with no accounts is all zeros", async () => {
    const base = `/v1/households/${await newHousehold()}`;
    const statement = (await as("GET", `${base}/reports/month-statement`)).json();
    expect(statement).toMatchObject({
      broughtForwardMinor: 0,
      receivedMinor: 0,
      spentMinor: 0,
      netWorthMinor: 0,
    });
  });
});
