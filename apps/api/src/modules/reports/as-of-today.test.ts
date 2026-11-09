import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueue } from "../../jobs/queue.js";
import { OWNER, jobRunner, request, useTestApp } from "../../test/helpers.js";

/*
 * Everything is "as of today" (Stage 19). A bill dated next week hasn't happened,
 * so it is in no balance, no total and no chart, in the household's own today.
 * Before this, the month statement said $3,950 while the account balance and the
 * net-worth chart said $2,450 for the same household on the same screen.
 *
 * The clock is fixed (like the Stage 17 tests): "tomorrow" breaks on month ends.
 */
/*
 * Dates are computed from the REAL clock, so this never rots: the pretend "today"
 * is always in the NEXT month, which means entries dated "later" were recorded
 * before their date (as in real life), whenever the suite runs.
 */
const realNow = new Date();
const day = (monthOffset: number, dayOfMonth: number) =>
  new Date(Date.UTC(realNow.getUTCFullYear(), realNow.getUTCMonth() + monthOffset, dayOfMonth))
    .toISOString()
    .slice(0, 10);
const LAST_MONTH = day(0, 15);
const TODAY = day(1, 10); // the pretend today
const LATER_THIS_MONTH = day(1, 20);
const NEXT_MONTH = day(2, 5);
const MONTH = TODAY.slice(0, 7);
const PREVIOUS_MONTH = LAST_MONTH.slice(0, 7);

describe("everything is as of today", () => {
  const ctx = useTestApp();
  afterEach(() => vi.useRealTimers());

  const as = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    request(ctx.app, OWNER, { method, url, ...(payload && { payload }) });

  /** A fresh household with one account that has history, today, and the future. */
  async function scenario() {
    const created = await as("POST", "/v1/households", { name: "AsOf Home", timeZone: "UTC" });
    const households = created.json().households as Array<{ id: string; name: string }>;
    const base = `/v1/households/${households.find((h) => h.name === "AsOf Home")!.id}`;
    const account = (
      await as("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
        openingBalanceMinor: 100_000,
      })
    ).json() as { id: string };
    const groceries = (
      (await as("GET", `${base}/categories`)).json().data as Array<{ id: string; name: string }>
    ).find((c) => c.name === "Groceries")!;
    const add = (
      amountMinor: number,
      occurredOn: string,
      description: string,
      categoryId?: string,
    ) =>
      as("POST", `${base}/transactions`, {
        accountId: account.id,
        amountMinor,
        occurredOn,
        description,
        ...(categoryId && { categoryId }),
      });

    await add(300_000, LAST_MONTH, "Salary");
    await add(-5_000, TODAY, "Coffee beans", groceries.id);
    await add(-150_000, LATER_THIS_MONTH, "Big shop, dated later", groceries.id);
    await add(40_000, LATER_THIS_MONTH, "Bonus, dated later");
    await add(-10_000, NEXT_MONTH, "Next month's bill", groceries.id);
    await as("POST", `${base}/budgets`, {
      categoryId: groceries.id,
      amountMinor: 100_000,
      startMonth: MONTH,
    });
    await as("POST", `${base}/goals`, {
      name: "Rainy day",
      accountId: account.id,
      targetMinor: 1_000_000,
    });
    return { base, accountId: account.id };
  }

  it("counts nothing that hasn't happened yet, in any balance, total or chart", async () => {
    const { base } = await scenario();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));

    // 100,000 opening + 300,000 salary − 5,000 coffee. Not the later bill, bonus or next month's bill.
    const AS_OF_TODAY = 395_000;

    const accounts = (await as("GET", `${base}/accounts`)).json().data as Array<{
      balanceMinor: number;
    }>;
    expect(accounts.map((a) => a.balanceMinor)).toEqual([AS_OF_TODAY]);

    const netWorth = (
      await as("GET", `${base}/reports/net-worth?from=${day(0, 1)}&to=${day(2, 1)}`)
    ).json();
    expect(netWorth.points.at(-1)).toEqual({ month: MONTH, balanceMinor: AS_OF_TODAY });

    const statement = (await as("GET", `${base}/reports/month-statement`)).json();
    expect(statement.netWorthMinor).toBe(AS_OF_TODAY);

    const cashflow = (
      await as("GET", `${base}/reports/cashflow?from=${day(0, 1)}&to=${day(3, 1)}`)
    ).json();
    expect(cashflow.months).toEqual([
      { month: PREVIOUS_MONTH, incomeMinor: 300_000, spendingMinor: 0, netMinor: 300_000 },
      // November: the bonus and the later shop aren't here yet. December isn't either.
      { month: MONTH, incomeMinor: 0, spendingMinor: 5_000, netMinor: -5_000 },
    ]);

    const byCategory = (
      await as("GET", `${base}/reports/spending-by-category?from=${day(1, 1)}&to=${day(2, 1)}`)
    ).json();
    expect(byCategory.totalMinor).toBe(5_000);

    const daily = (
      await as("GET", `${base}/reports/daily-cashflow?from=${day(1, 1)}&to=${day(2, 1)}`)
    ).json();
    expect(daily.days).toEqual([{ date: TODAY, incomeMinor: 0, spendingMinor: 5_000 }]);

    const budgets = (await as("GET", `${base}/budgets?month=${MONTH}`)).json();
    expect(budgets.budgets[0]).toMatchObject({
      name: "Groceries",
      spentMinor: 5_000,
      status: "ok",
    });

    const goals = (await as("GET", `${base}/goals`)).json().data as Array<{ balanceMinor: number }>;
    expect(goals[0]!.balanceMinor).toBe(AS_OF_TODAY);
  });

  it("still lists the future-dated entries: you can see what is coming", async () => {
    const { base } = await scenario();
    const listed = (await as("GET", `${base}/transactions?limit=50`)).json().data as Array<{
      description: string;
    }>;
    expect(listed.map((t) => t.description)).toEqual(
      expect.arrayContaining(["Big shop, dated later", "Bonus, dated later", "Next month's bill"]),
    );
  });

  it("the day arrives, and the entry counts (no edit needed)", async () => {
    const { base } = await scenario();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${LATER_THIS_MONTH}T08:00:00Z`));
    const accounts = (await as("GET", `${base}/accounts`)).json().data as Array<{
      balanceMinor: number;
    }>;
    // + the bonus, − the big shop, both now dated today.
    expect(accounts[0]!.balanceMinor).toBe(395_000 + 40_000 - 150_000);
  });

  it("a budget alert fires on the day a bill arrives, without anyone editing anything", async () => {
    await scenario();
    const notifications = async () =>
      (await as("GET", "/v1/notifications")).json().data as Array<{ kind: string; title: string }>;
    const budgetAlerts = async () =>
      (await notifications()).filter((n) => n.kind.startsWith("budget."));

    // On the 10th the jobs queued by entering the bills run: Groceries is at 5,000 of 100,000.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
    await jobRunner(ctx.db).run();
    expect(await budgetAlerts()).toEqual([]);

    // The 20th: the big shop (entered long ago) is now today's, and over the limit.
    // Nobody edits anything, so only the daily check can notice.
    vi.setSystemTime(new Date(`${LATER_THIS_MONTH}T08:00:00Z`));
    await enqueue(ctx.db, "budgets.evaluate-due", {});
    await jobRunner(ctx.db).run();
    const alerts = await budgetAlerts();
    expect(alerts.some((n) => n.kind === "budget.over" && n.title.includes("Groceries"))).toBe(
      true,
    );
  });
});
