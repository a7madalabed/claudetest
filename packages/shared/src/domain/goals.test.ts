import { describe, expect, it } from "vitest";
import { projectGoal } from "./goals.js";

const base = { targetMinor: 1_000_000, today: "2026-06-15" };

describe("projectGoal", () => {
  it("is reached once the balance meets the target", () => {
    const p = projectGoal({
      ...base,
      balanceMinor: 1_200_000,
      targetDate: null,
      monthEndBalances: [],
    });
    expect(p.status).toBe("reached");
    expect(p.progress).toBe(1);
    expect(p.remainingMinor).toBe(0);
  });

  it("projects from the average monthly change", () => {
    const p = projectGoal({
      ...base,
      balanceMinor: 600_000,
      targetDate: "2026-12-01",
      monthEndBalances: [400_000, 450_000, 500_000, 550_000, 600_000],
    });
    expect(p.monthlyPaceMinor).toBe(50_000);
    expect(p.projectedMonth).toBe("2027-02"); // 400,000 left ÷ 50,000 = 8 months
    expect(p.status).toBe("behind");
    expect(p.requiredMonthlyMinor).toBe(66_667); // 400,000 over 6 months, rounded UP
    expect(p.progress).toBeCloseTo(0.6);
  });

  it("is on track when the projection lands before the target date", () => {
    const p = projectGoal({
      ...base,
      balanceMinor: 900_000,
      targetDate: "2026-12-01",
      monthEndBalances: [700_000, 800_000, 900_000],
    });
    expect(p.projectedMonth).toBe("2026-07");
    expect(p.status).toBe("on_track");
  });

  it("only uses the last 6 changes", () => {
    const p = projectGoal({
      ...base,
      balanceMinor: 600_000,
      targetDate: null,
      // An old windfall (+500,000) falls outside the window.
      monthEndBalances: [0, 500_000, 500_000, 520_000, 540_000, 560_000, 580_000, 600_000],
    });
    expect(p.monthlyPaceMinor).toBe(16_667);
    expect(p.status).toBe("no_deadline");
  });

  it("reports no progress when the balance is flat or falling", () => {
    const p = projectGoal({
      ...base,
      balanceMinor: 300_000,
      targetDate: "2027-06-01",
      monthEndBalances: [320_000, 310_000, 300_000],
    });
    expect(p.status).toBe("no_progress");
    expect(p.projectedMonth).toBeNull();
    expect(p.requiredMonthlyMinor).toBe(58_334);
  });

  it("never reports progress below zero", () => {
    const p = projectGoal({
      ...base,
      balanceMinor: -5_000,
      targetDate: null,
      monthEndBalances: [],
    });
    expect(p.progress).toBe(0);
  });
});
