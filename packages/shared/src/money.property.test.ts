import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney, sumMinorUnits } from "./money.js";
import { safeInteger } from "./test/arbitraries.js";

const CURRENCIES = ["USD", "EUR", "JPY", "JOD"] as const;

describe("money properties", () => {
  it("formatMoney → parseMoney gives back exactly the same amount, for every safe integer", () => {
    fc.assert(
      fc.property(
        safeInteger.filter((n) => n >= 0),
        fc.constantFrom(...CURRENCIES),
        (amount, currency) => {
          // Strip the symbol; parseMoney reads what a person types ("1,234.56").
          const typed = formatMoney(amount, currency).replace(/[^\d.,]/g, "");
          expect(parseMoney(typed, currency)).toBe(amount);
        },
      ),
    );
  });

  it("regression: large amounts used to be formatted a cent off (found by the property above)", () => {
    expect(formatMoney(7059166453011543, "USD")).toBe("$70,591,664,530,115.43");
    expect(formatMoney(-Number.MAX_SAFE_INTEGER, "USD")).toBe("-$90,071,992,547,409.91");
  });

  it("parseMoney never throws, and returns null or a non-negative safe integer", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...CURRENCIES), (input, currency) => {
        const result = parseMoney(input, currency);
        expect(result === null || (Number.isSafeInteger(result) && result >= 0)).toBe(true);
      }),
    );
  });

  it("sums are exact and don't depend on order", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1e12, max: 1e12 }), { maxLength: 50 }), (xs) => {
        const total = sumMinorUnits(xs);
        expect(total).toBe(xs.reduce((a, b) => a + b, 0));
        expect(sumMinorUnits([...xs].reverse())).toBe(total);
      }),
    );
  });
});
