import { describe, expect, it } from "vitest";
import { formatDay, formatMonth, monthRange } from "./dates";

// vitest.config.ts runs the suite in America/Los_Angeles, where the classic
// "new Date('2026-03-14') is the 13th" bug would show.
describe("dates", () => {
  it("formats calendar days as the same day, whatever the viewer's time zone", () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).not.toBe(0); // really not UTC
    expect(formatDay("2026-03-14")).toBe("Mar 14");
    expect(formatDay("2026-01-01")).toBe("Jan 1");
    expect(formatMonth("2026-12")).toBe("Dec");
  });

  it("builds half-open month ranges on the local calendar, across year ends", () => {
    const now = new Date(2026, 0, 31, 23, 30); // late on Jan 31, local time
    expect(monthRange(0, now)).toEqual({ from: "2026-01-01", to: "2026-02-01" });
    expect(monthRange(2, now)).toEqual({ from: "2025-11-01", to: "2026-02-01" });
    expect(monthRange(0, new Date(2026, 11, 15))).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });
});
