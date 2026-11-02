import { describe, expect, it } from "vitest";
import { isValidMonth, localMonth, localToday, monthElapsed } from "./budgets";

describe("budget helpers", () => {
  const now = new Date(2026, 5, 15, 23, 30); // June 15, 11:30pm LOCAL time

  it("uses the user's local calendar, not UTC", () => {
    expect(localToday(now)).toBe("2026-06-15");
    expect(localMonth(now)).toBe("2026-06");
  });

  it("measures how far through the month we are", () => {
    expect(monthElapsed("2026-06", now)).toBeCloseTo(15 / 30);
    expect(monthElapsed("2026-05", now)).toBe(1);
    expect(monthElapsed("2026-07", now)).toBe(0);
  });

  it("validates ?month= values from the URL", () => {
    expect(isValidMonth("2026-06")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("June")).toBe(false);
    expect(isValidMonth(null)).toBe(false);
  });
});
