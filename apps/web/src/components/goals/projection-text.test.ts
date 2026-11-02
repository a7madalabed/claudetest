import type { GoalDto } from "@ledgerly/shared";
import { describe, expect, it } from "vitest";
import { projectionText } from "./goals-view";

const goal = (overrides: Partial<GoalDto>): GoalDto => ({
  id: "g",
  name: "Fund",
  accountId: "a",
  accountName: "Savings",
  currency: "USD",
  targetMinor: 1_000_000,
  targetDate: "2027-06-01",
  balanceMinor: 400_000,
  progress: 0.4,
  remainingMinor: 600_000,
  monthlyPaceMinor: 50_000,
  projectedMonth: "2027-12",
  requiredMonthlyMinor: 75_000,
  status: "behind",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("projectionText", () => {
  it("explains a late goal and what it would take", () => {
    expect(projectionText(goal({}))).toBe(
      "At $500/mo, you'll get there by December 2027, 6 months late. Saving $750.00/mo would hit June 2027.",
    );
  });

  it("is encouraging when on track", () => {
    expect(projectionText(goal({ status: "on_track", projectedMonth: "2027-03" }))).toBe(
      "At $500/mo, you'll get there by March 2027, ahead of June 2027.",
    );
  });

  it("doesn't print absurd dates for a tiny pace", () => {
    expect(projectionText(goal({ monthlyPaceMinor: 100, projectedMonth: "2526-01" }))).toMatch(
      /more than 10 years/,
    );
  });
});
