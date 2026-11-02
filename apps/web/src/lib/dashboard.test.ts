import { describe, expect, it } from "vitest";
import { monthToDate, relativeChange, savingsRate, spendingPace, trendRange } from "./dashboard";

const now = new Date(2026, 2, 10); // 10 March 2026 (local)
const day = (date: string, spendingMinor: number, incomeMinor = 0) => ({
  date,
  spendingMinor,
  incomeMinor,
});

describe("dashboard maths", () => {
  it("compares month-to-date with the SAME days of last month", () => {
    const days = [
      day("2026-02-05", 1_000),
      day("2026-02-20", 99_999),
      day("2026-03-04", 1_500),
      day("2026-03-01", 0, 300_000),
    ];
    const { current, previous } = monthToDate(days, now);
    expect(current).toEqual({ income: 300_000, spending: 1_500 });
    expect(previous).toEqual({ income: 0, spending: 1_000 }); // Feb 20 is after "day 10" → excluded
  });

  it("handles a shorter previous month (31 March vs 28 February)", () => {
    const { previous } = monthToDate([day("2026-02-28", 700)], new Date(2026, 2, 31));
    expect(previous.spending).toBe(700);
  });

  it("relative change and savings rate guard against division by zero", () => {
    expect(relativeChange(150, 100)).toBe(0.5);
    expect(relativeChange(50, 0)).toBeNull();
    expect(savingsRate(1_000, 800)).toBeCloseTo(0.2);
    expect(savingsRate(0, 800)).toBeNull();
  });

  it("builds cumulative pace lines that stop at today", () => {
    const pace = spendingPace(
      [
        day("2026-03-02", 500),
        day("2026-03-09", 250),
        day("2026-02-01", 100),
        day("2026-02-28", 900),
      ],
      now,
    );
    expect(pace).toHaveLength(31);
    expect(pace[0]).toEqual({ day: 1, thisMonth: 0, lastMonth: 100 });
    expect(pace[9]).toEqual({ day: 10, thisMonth: 750, lastMonth: 100 });
    expect(pace[10]!.thisMonth).toBeNull(); // the future
    expect(pace[27]!.lastMonth).toBe(1_000);
    expect(pace[28]!.lastMonth).toBeNull(); // February had 28 days
  });

  it("computes trend ranges as half-open month windows", () => {
    expect(trendRange("3m", now)).toEqual({ from: "2026-01-01", to: "2026-04-01" });
    expect(trendRange("12m", now)).toEqual({ from: "2025-04-01", to: "2026-04-01" });
    expect(trendRange("ytd", now)).toEqual({ from: "2026-01-01", to: "2026-04-01" });
  });
});
