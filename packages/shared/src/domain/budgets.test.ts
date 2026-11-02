import { describe, expect, it } from "vitest";
import { amountForMonth, budgetStatus, computeBudgetMonth } from "./budgets.js";
import { addMonths, monthDiff, monthsBetween, todayIn } from "./months.js";

describe("months", () => {
  it("adds and diffs across year boundaries", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthDiff("2025-12", "2026-02")).toBe(2);
    expect(monthsBetween("2025-11", "2026-01")).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(monthsBetween("2026-02", "2026-01")).toEqual([]);
  });
});

describe("amountForMonth (effective dating)", () => {
  const changes = [
    { effectiveMonth: "2026-01-01", amountMinor: 40_000 },
    { effectiveMonth: "2026-04-01", amountMinor: 50_000 },
  ];
  it("uses the latest change effective on or before the month", () => {
    expect(amountForMonth(changes, "2025-12")).toBeNull();
    expect(amountForMonth(changes, "2026-01")).toBe(40_000);
    expect(amountForMonth(changes, "2026-03")).toBe(40_000);
    expect(amountForMonth(changes, "2026-04")).toBe(50_000);
    expect(amountForMonth(changes, "2027-01")).toBe(50_000);
  });
  it("does not depend on the order changes arrive in", () => {
    expect(amountForMonth([...changes].reverse(), "2026-05")).toBe(50_000);
  });
});

describe("budgetStatus", () => {
  it.each([
    [0, 10_000, "ok"],
    [7_999, 10_000, "ok"],
    [8_000, 10_000, "warning"], // 80% exactly is a warning
    [10_000, 10_000, "warning"], // spending all of it is not OVER
    [10_001, 10_000, "over"],
    [0, 0, "ok"],
    [1, 0, "over"],
    [0, -500, "over"], // rolled-over overspend leaves you negative before spending anything
  ] as const)("spent %i of %i → %s", (spent, available, expected) => {
    expect(budgetStatus(spent, available)).toBe(expected);
  });
});

describe("computeBudgetMonth", () => {
  const amounts = [{ effectiveMonth: "2026-01-01", amountMinor: 10_000 }];
  const spent = new Map([
    ["2026-01", 6_000], // 4,000 under
    ["2026-02", 13_000], // 3,000 over
    ["2026-03", 2_000],
  ]);

  it("returns null before the budget starts", () => {
    expect(
      computeBudgetMonth({
        startMonth: "2026-01-01",
        amounts,
        rollover: false,
        spentByMonth: spent,
        month: "2025-12",
      }),
    ).toBeNull();
  });

  it("without rollover, every month starts fresh", () => {
    const march = computeBudgetMonth({
      startMonth: "2026-01-01",
      amounts,
      rollover: false,
      spentByMonth: spent,
      month: "2026-03",
    });
    expect(march).toEqual({
      amountMinor: 10_000,
      rolloverMinor: 0,
      availableMinor: 10_000,
      spentMinor: 2_000,
      remainingMinor: 8_000,
      status: "ok",
    });
  });

  it("with rollover, underspend accumulates and overspend is paid back", () => {
    const at = (month: string) =>
      computeBudgetMonth({
        startMonth: "2026-01-01",
        amounts,
        rollover: true,
        spentByMonth: spent,
        month,
      })!;
    expect(at("2026-01").rolloverMinor).toBe(0);
    expect(at("2026-02").rolloverMinor).toBe(4_000); // Jan: 10,000 − 6,000
    expect(at("2026-02").availableMinor).toBe(14_000);
    expect(at("2026-02").status).toBe("warning"); // 13,000 of 14,000
    expect(at("2026-03").rolloverMinor).toBe(1_000); // Feb: 14,000 − 13,000
    expect(at("2026-04").rolloverMinor).toBe(9_000); // Mar: 11,000 − 2,000
  });

  it("rollover can go negative", () => {
    const heavy = new Map([["2026-01", 25_000]]);
    const feb = computeBudgetMonth({
      startMonth: "2026-01-01",
      amounts,
      rollover: true,
      spentByMonth: heavy,
      month: "2026-02",
    })!;
    expect(feb.rolloverMinor).toBe(-15_000);
    expect(feb.availableMinor).toBe(-5_000);
    expect(feb.status).toBe("over");
  });

  it("uses each month's own amount when carrying forward", () => {
    const changing = [...amounts, { effectiveMonth: "2026-02-01", amountMinor: 20_000 }];
    const march = computeBudgetMonth({
      startMonth: "2026-01-01",
      amounts: changing,
      rollover: true,
      spentByMonth: spent,
      month: "2026-03",
    })!;
    // Jan carry 4,000 → Feb available 24,000 − 13,000 = 11,000 carried into March.
    expect(march.amountMinor).toBe(20_000);
    expect(march.rolloverMinor).toBe(11_000);
  });
});

describe("todayIn", () => {
  it("uses the household's calendar, not UTC", () => {
    const lateOctober31InLA = new Date("2026-11-01T06:30:00Z"); // 11:30 pm Oct 31 in Los Angeles
    expect(todayIn("America/Los_Angeles", lateOctober31InLA)).toBe("2026-10-31");
    expect(todayIn("UTC", lateOctober31InLA)).toBe("2026-11-01");
    expect(todayIn("Asia/Tokyo", lateOctober31InLA)).toBe("2026-11-01");
  });
});
