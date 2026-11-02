import { describe, expect, it } from "vitest";
import {
  applyMapping,
  detectDateFormats,
  guessMapping,
  parseImportAmount,
  parseImportDate,
  type ImportMapping,
} from "./csv-import.js";

describe("parseImportDate", () => {
  it.each([
    ["2026-03-04", "YMD", "2026-03-04"],
    ["2026/3/4", "YMD", "2026-03-04"],
    ["03/04/2026", "MDY", "2026-03-04"],
    ["03/04/2026", "DMY", "2026-04-03"],
    ["4.3.26", "DMY", "2026-03-04"],
    ["2026-03-04T10:22:00Z", "YMD", "2026-03-04"],
  ] as const)("%s as %s → %s", (text, format, expected) => {
    expect(parseImportDate(text, format)).toBe(expected);
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseImportDate("02/30/2026", "MDY")).toBeNull();
    expect(parseImportDate("13/01/2026", "MDY")).toBeNull();
    expect(parseImportDate("yesterday", "YMD")).toBeNull();
  });
});

describe("detectDateFormats", () => {
  it("finds the only format that fits every row", () => {
    expect(detectDateFormats(["03/04/2026", "25/04/2026"])).toEqual(["DMY"]);
    expect(detectDateFormats(["2026-01-31"])).toEqual(["YMD"]);
  });
  it("tolerates a few junk rows, but not a column of junk", () => {
    const rows = ["03/14/2026", "03/15/2026", "03/16/2026", "03/17/2026", "Pending"];
    expect(detectDateFormats(rows)).toEqual(["MDY"]);
    expect(detectDateFormats(["Coffee", "Rent", "03/14/2026"])).toEqual([]);
  });

  it("reports genuine ambiguity (the user must choose)", () => {
    expect(detectDateFormats(["03/04/2026", "05/06/2026"])).toEqual(["MDY", "DMY"]);
  });
});

describe("parseImportAmount", () => {
  it.each([
    ["-12.50", -1250],
    ["12.50", 1250],
    ["$1,234.56", 123456],
    ["(45.00)", -4500],
    ["45.00-", -4500],
    ["1.234,56", 123456],
    ["−", null],
    ["", null],
    ["1,234", 123400],
    ["USD 9.99", 999],
  ] as const)("%s → %s", (text, expected) => {
    expect(parseImportAmount(text)).toBe(expected);
  });
});

describe("guessMapping", () => {
  it("reads a typical single-amount export from its headers", () => {
    const guess = guessMapping([
      ["Date", "Description", "Amount", "Balance"],
      ["2026-10-01", "RENT OCTOBER", "-1650.00", "3200.00"],
      ["2026-10-02", "Trader Joe's", "-54.20", "3145.80"],
    ]);
    expect(guess?.mapping).toEqual({
      hasHeader: true,
      dateColumn: 0,
      dateFormat: "YMD",
      descriptionColumn: 1,
      amount: { type: "single", column: 2, negate: false },
    });
  });

  it("recognises separate money-out / money-in columns", () => {
    const guess = guessMapping([
      ["Posted", "Payee", "Debit", "Credit"],
      ["25/10/2026", "Coffee", "4.50", ""],
      ["26/10/2026", "Salary", "", "2125.00"],
    ]);
    expect(guess?.mapping.amount).toEqual({ type: "split", debitColumn: 2, creditColumn: 3 });
    expect(guess?.dateFormats).toEqual(["DMY"]);
  });

  it("works without a header row, from the content alone", () => {
    const guess = guessMapping([
      ["10/01/2026", "-12.00", "Coffee shop downtown"],
      ["10/02/2026", "-40.00", "Gas station"],
    ]);
    expect(guess?.mapping).toMatchObject({
      hasHeader: false,
      dateColumn: 0,
      descriptionColumn: 2,
      amount: { type: "single", column: 1 },
    });
  });

  it("settles the date format using every row, not just the first few", () => {
    const rows = [["Date", "Description", "Amount"]];
    for (let i = 0; i < 60; i++) rows.push(["11/01/2025", "Coffee", "-4.00"]);
    rows.push(["11/13/2025", "Coffee", "-4.00"]); // only month-first can read this
    expect(guessMapping(rows)?.dateFormats).toEqual(["MDY"]);
  });

  it("gives up when there's no date column", () => {
    expect(
      guessMapping([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBeNull();
  });
});

describe("applyMapping", () => {
  const single: ImportMapping = {
    hasHeader: true,
    dateColumn: 0,
    dateFormat: "MDY",
    descriptionColumn: 1,
    amount: { type: "single", column: 2, negate: false },
  };

  it("produces a transaction-shaped row", () => {
    expect(applyMapping(["10/03/2026", "  Trader   Joe's ", "-54.20"], single)).toEqual({
      ok: true,
      occurredOn: "2026-10-03",
      description: "Trader Joe's",
      amountMinor: -5420,
    });
  });

  it("flips signs for exports that show spending as positive", () => {
    const negate = { ...single, amount: { type: "single" as const, column: 2, negate: true } };
    expect(applyMapping(["10/03/2026", "Shop", "20.00"], negate)).toMatchObject({
      amountMinor: -2000,
    });
  });

  it("combines debit and credit columns", () => {
    const split: ImportMapping = {
      ...single,
      amount: { type: "split", debitColumn: 2, creditColumn: 3 },
    };
    expect(applyMapping(["10/03/2026", "Coffee", "4.50", ""], split)).toMatchObject({
      amountMinor: -450,
    });
    expect(applyMapping(["10/03/2026", "Refund", "", "10.00"], split)).toMatchObject({
      amountMinor: 1000,
    });
  });

  it("explains rows it can't import", () => {
    expect(applyMapping(["31/31/2026", "x", "1"], single)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/date/),
    });
    expect(applyMapping(["10/03/2026", "", "1"], single)).toEqual({
      ok: false,
      error: "Missing description",
    });
    expect(applyMapping(["10/03/2026", "x", "abc"], single)).toEqual({
      ok: false,
      error: "Unreadable amount",
    });
    expect(applyMapping(["10/03/2026", "x", "0.00"], single)).toEqual({
      ok: false,
      error: "Zero amount",
    });
  });
});
