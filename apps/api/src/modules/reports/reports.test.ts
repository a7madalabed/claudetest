import { describe, expect, it } from "vitest";
import { OWNER, request, useTestApp } from "../../test/helpers.js";

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
});
