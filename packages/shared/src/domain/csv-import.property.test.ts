import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatMoney } from "../money.js";
import { amountMinor, csvCell, isoDate } from "../test/arbitraries.js";
import {
  applyMapping,
  detectDateFormats,
  parseImportAmount,
  parseImportDate,
  type DateFormat,
  type ImportMapping,
} from "./csv-import.js";

const FORMATS: DateFormat[] = ["YMD", "MDY", "DMY"];
const isValidIsoDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** Write a date the way some bank might: chosen order, separator, padding and year length. */
const renderedDate = fc
  .record({
    iso: isoDate,
    format: fc.constantFrom(...FORMATS),
    sep: fc.constantFrom("/", "-", "."),
    pad: fc.boolean(),
    shortYear: fc.boolean(),
  })
  .map(({ iso, format, sep, pad, shortYear }) => {
    const [y, m, d] = iso.split("-") as [string, string, string];
    const n = (s: string) => (pad ? s : String(Number(s)));
    // Two-digit years mean 20xx, so only use them for this century.
    const year = shortYear && format !== "YMD" && y.startsWith("20") ? y.slice(2) : y;
    const parts = { YMD: [y, n(m), n(d)], MDY: [n(m), n(d), year], DMY: [n(d), n(m), year] };
    return { iso, format, text: parts[format].join(sep) };
  });

/** Write an amount the way some bank might: symbols, grouping, European commas, accounting brackets. */
const renderedAmount = fc
  .record({
    amount: amountMinor,
    style: fc.constantFrom("plain", "us", "symbol", "european", "brackets", "trailing"),
  })
  .map(({ amount, style }) => {
    const us = formatMoney(Math.abs(amount), "USD").slice(1); // "1,234.56"
    const plain = us.replace(/,/g, ""); // "1234.56"
    const eu = us.replace(/[,.]/g, (c) => (c === "," ? "." : ",")); // "1.234,56"
    const minus = amount < 0 ? "-" : "";
    const text = {
      plain: `${minus}${plain}`,
      us: `${minus}${us}`,
      symbol: `${minus}$${us}`,
      european: `${minus}${eu} €`,
      brackets: amount < 0 ? `(${us})` : us,
      trailing: `${us}${minus}`,
    }[style];
    return { amount, text };
  });

describe("CSV import properties", () => {
  it("reads back every date, in every format a bank might write it", () => {
    fc.assert(
      fc.property(renderedDate, ({ iso, format, text }) => {
        expect(parseImportDate(text, format)).toBe(iso);
        expect(detectDateFormats([text])).toContain(format);
      }),
      { numRuns: 500 },
    );
  });

  it("reads back every amount, in every style a bank might write it", () => {
    fc.assert(
      fc.property(renderedAmount, ({ amount, text }) => {
        expect(parseImportAmount(text)).toBe(amount);
      }),
      { numRuns: 500 },
    );
  });

  it("never throws on junk, and only ever returns a real date or an exact integer", () => {
    fc.assert(
      fc.property(csvCell, fc.constantFrom(...FORMATS), (cell, format) => {
        const date = parseImportDate(cell, format);
        expect(date === null || isValidIsoDate(date)).toBe(true);
        const amount = parseImportAmount(cell);
        expect(amount === null || Number.isSafeInteger(amount)).toBe(true);
      }),
      { numRuns: 1_000 },
    );
  });

  it("applyMapping turns ANY row into either a clean transaction or a reason", () => {
    const column = fc.integer({ min: 0, max: 5 });
    const mapping: fc.Arbitrary<ImportMapping> = fc.record({
      hasHeader: fc.boolean(),
      dateColumn: column,
      dateFormat: fc.constantFrom(...FORMATS),
      descriptionColumn: column,
      amount: fc.oneof(
        fc.record({ type: fc.constant("single" as const), column, negate: fc.boolean() }),
        fc.record({
          type: fc.constant("split" as const),
          debitColumn: column,
          creditColumn: column,
        }),
      ),
    });
    fc.assert(
      fc.property(fc.array(csvCell, { maxLength: 6 }), mapping, (row, m) => {
        const result = applyMapping(row, m);
        if (!result.ok) {
          expect(result.error.length).toBeGreaterThan(0);
          return;
        }
        expect(isValidIsoDate(result.occurredOn)).toBe(true);
        expect(Number.isSafeInteger(result.amountMinor)).toBe(true);
        expect(result.amountMinor).not.toBe(0);
        expect(result.description).toBe(result.description.trim());
        expect(result.description).not.toMatch(/\s{2}/);
        expect(result.description.length).toBeGreaterThan(0);
        expect(result.description.length).toBeLessThanOrEqual(200);
      }),
      { numRuns: 1_000 },
    );
  });
});
