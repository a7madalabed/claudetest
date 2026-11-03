import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isoDate, yearMonth } from "../test/arbitraries.js";
import { addMonths, monthDiff, monthsBetween } from "./months.js";
import { nextRecurringDate, type RecurrenceRule } from "./recurring.js";

const lastDayOf = (date: string) => {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const dayOf = (date: string) => Number(date.slice(8, 10));
/** The day a rule SHOULD land on in `date`'s month: its anchor, clamped to the month's length. */
const clamped = (anchor: number, date: string) => Math.min(anchor, lastDayOf(date));
const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;

const dayOfMonth = fc.integer({ min: 1, max: 31 });

describe("month arithmetic properties", () => {
  it("adding months composes, and monthDiff undoes it", () => {
    const span = fc.integer({ min: -600, max: 600 });
    fc.assert(
      fc.property(yearMonth, span, span, (m, a, b) => {
        expect(addMonths(addMonths(m, a), b)).toBe(addMonths(m, a + b));
        expect(monthDiff(m, addMonths(m, a))).toBe(a);
        expect(addMonths(m, a)).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
      }),
    );
  });

  it("monthsBetween lists each month once, in order, end to end", () => {
    fc.assert(
      fc.property(yearMonth, fc.integer({ min: 0, max: 240 }), (from, n) => {
        const months = monthsBetween(from, addMonths(from, n));
        expect(months).toHaveLength(n + 1);
        expect(months[0]).toBe(from);
        expect(months.at(-1)).toBe(addMonths(from, n));
        expect([...months].sort()).toEqual(months);
      }),
    );
  });
});

describe("recurring schedule properties", () => {
  it("monthly: the next date is strictly later, on the anchor (clamped), and skips no month", () => {
    fc.assert(
      fc.property(dayOfMonth, isoDate, (anchorDay, after) => {
        const next = nextRecurringDate({ cadence: "monthly", anchorDay }, after);
        expect(next > after).toBe(true);
        expect(dayOf(next)).toBe(clamped(anchorDay, next));
        expect(monthDiff(after.slice(0, 7), next.slice(0, 7))).toBeLessThanOrEqual(1);
      }),
      { numRuns: 1_000 },
    );
  });

  it("monthly: following the schedule for years never drifts off its anchor", () => {
    // The bug this guards: 31st → Feb 28 → Mar 28 → … (the rule forgot it was "the 31st").
    fc.assert(
      fc.property(dayOfMonth, isoDate, (anchorDay, start) => {
        let date = start;
        for (let i = 0; i < 36; i++) {
          const next = nextRecurringDate({ cadence: "monthly", anchorDay }, date);
          expect(dayOf(next)).toBe(clamped(anchorDay, next));
          expect(monthDiff(date.slice(0, 7), next.slice(0, 7))).toBeLessThanOrEqual(1);
          date = next;
        }
      }),
      { numRuns: 200 },
    );
  });

  it("twice monthly: lands on one of its two days, never more than a month apart", () => {
    fc.assert(
      fc.property(dayOfMonth, dayOfMonth, isoDate, (anchorDay, secondDay, after) => {
        const rule: RecurrenceRule = { cadence: "twice_monthly", anchorDay, secondDay };
        const next = nextRecurringDate(rule, after);
        expect(next > after).toBe(true);
        expect([clamped(anchorDay, next), clamped(secondDay, next)]).toContain(dayOf(next));
        expect(daysBetween(after, next)).toBeLessThanOrEqual(31);
      }),
      { numRuns: 1_000 },
    );
  });

  it("agrees with a slow-but-obviously-correct oracle: the first matching day after `after`", () => {
    // The oracle walks forward one day at a time. Too slow for production,
    // too simple to be wrong — a "test oracle".
    const oracle = (days: number[], after: string) => {
      let t = Date.parse(`${after}T00:00:00Z`);
      for (;;) {
        t += DAY_MS;
        const date = new Date(t).toISOString().slice(0, 10);
        if (days.some((d) => dayOf(date) === clamped(d, date))) return date;
      }
    };
    fc.assert(
      fc.property(dayOfMonth, fc.option(dayOfMonth), isoDate, (anchorDay, secondDay, after) => {
        const rule: RecurrenceRule =
          secondDay === null
            ? { cadence: "monthly", anchorDay }
            : { cadence: "twice_monthly", anchorDay, secondDay };
        const days = secondDay === null ? [anchorDay] : [anchorDay, secondDay];
        expect(nextRecurringDate(rule, after)).toBe(oracle(days, after));
      }),
      { numRuns: 2_000 },
    );
  });

  it("weekly: always exactly seven days later, across month, year and leap-day boundaries", () => {
    fc.assert(
      fc.property(isoDate, (after) => {
        expect(daysBetween(after, nextRecurringDate({ cadence: "weekly" }, after))).toBe(7);
      }),
    );
  });
});
