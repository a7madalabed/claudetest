import { describe, expect, it } from "vitest";
import { householdNow, isValidMonth, localMonth, localToday, monthElapsed } from "./budgets";

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

describe("householdNow (Stage 17)", () => {
  // These tests run in America/Los_Angeles (vitest.config.ts): far from both zones below.
  const instant = new Date("2026-06-30T10:30:00Z");

  it("reads the clock in the household's time zone, not the browser's", () => {
    // 10:30 UTC is already 00:30 on July 1st on UTC+14, still June 30th in LA.
    expect(localToday(householdNow("Pacific/Kiritimati", instant))).toBe("2026-07-01");
    expect(localMonth(householdNow("Pacific/Kiritimati", instant))).toBe("2026-07");
    expect(localToday(householdNow("America/Los_Angeles", instant))).toBe("2026-06-30");
    expect(localToday(householdNow("UTC", instant))).toBe("2026-06-30");
  });

  it("falls back to the browser's clock while the household is loading", () => {
    expect(householdNow(undefined, instant)).toBe(instant);
  });
});
