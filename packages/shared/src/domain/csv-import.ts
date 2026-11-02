import { parseMoney } from "../money.js";

/*
 * Turning rows from a bank's CSV export into transactions. Every bank formats
 * its export differently, so instead of guessing silently we:
 *   1. GUESS a mapping (which column is the date, the amount…) from headers and content,
 *   2. SHOW the user a preview of what that mapping produces,
 *   3. let them FIX it, then import with exactly what they confirmed.
 * These functions are pure and shared: the browser uses them for the live
 * preview and the background job uses the SAME code for the real import.
 */

export type DateFormat = "YMD" | "MDY" | "DMY";

export type AmountMapping =
  /** One signed column. `negate` flips signs (some cards show purchases as positive). */
  | { type: "single"; column: number; negate: boolean }
  /** Separate money-out / money-in columns (one of them is empty on each row). */
  | { type: "split"; debitColumn: number; creditColumn: number };

export interface ImportMapping {
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: DateFormat;
  descriptionColumn: number;
  amount: AmountMapping;
}

export type MappedRow =
  | { ok: true; occurredOn: string; description: string; amountMinor: number }
  | { ok: false; error: string };

// ─── Dates ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last || year < 1900 || year > 2100) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "03/04/2026" + "MDY" → "2026-03-04". Accepts / - . separators and 2-digit years (20xx). Null if invalid. */
export function parseImportDate(text: string, format: DateFormat): string | null {
  const parts = text.trim().split(/[T\s]/)[0]!.split(/[/.-]/);
  if (parts.length !== 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null;
  const nums = parts.map(Number) as [number, number, number];
  const year = (y: number, raw: string) =>
    raw.length === 2 ? 2000 + y : raw.length === 4 ? y : NaN;
  if (format === "YMD") return parts[0]!.length === 4 ? validDate(nums[0], nums[1], nums[2]) : null;
  const y = year(nums[2], parts[2]!);
  if (Number.isNaN(y)) return null;
  return format === "MDY" ? validDate(y, nums[0], nums[1]) : validDate(y, nums[1], nums[0]);
}

/**
 * Which formats read the samples as valid dates? "03/04/2026" fits both MDY and
 * DMY — genuinely ambiguous, and only the user knows; "25/04/2026" can only be
 * DMY. The UI asks when more than one format fits.
 *
 * Real exports contain junk (footer lines, "Pending" rows), so a format only
 * has to read 80% of the rows — the best-scoring formats win.
 */
export function detectDateFormats(samples: string[]): DateFormat[] {
  const values = samples.map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) return [];
  const scores = (["YMD", "MDY", "DMY"] as const).map((format) => ({
    format,
    hits: values.filter((v) => parseImportDate(v, format) !== null).length,
  }));
  const best = Math.max(...scores.map((s) => s.hits));
  if (best === 0 || best / values.length < 0.8) return [];
  return scores.filter((s) => s.hits === best).map((s) => s.format);
}

// ─── Amounts ─────────────────────────────────────────────────────────────────

/**
 * "$1,234.56" → 123456 · "-12.00" → -1200 · "(12.00)" → -1200 (accounting style)
 * "12.00-" → -1200 · "1.234,56" → 123456 (European) · "" → null
 */
export function parseImportAmount(text: string, currency = "USD"): number | null {
  let s = text.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    negative = !negative;
    s = s.replace(/-\s*$/, "");
  }
  s = s.replace(/[^\d.,-]/g, ""); // currency symbols, spaces, letters
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;
  // The LAST separator followed by 1–2 digits is the decimal point; any others group thousands.
  const decimal = /[.,](\d{1,2})$/.exec(s);
  const normalised = decimal
    ? `${s.slice(0, decimal.index).replace(/[.,]/g, "")}.${decimal[1]}`
    : s.replace(/[.,]/g, "");
  const value = parseMoney(normalised, currency);
  if (value === null) return null;
  return negative ? -value : value;
}

// ─── Guessing a mapping ──────────────────────────────────────────────────────

const HEADER_HINTS = {
  date: /date|posted|booking|value date|time/i,
  description: /desc|payee|merchant|details|memo|narrative|name|reference|particulars/i,
  amount: /amount|value|sum|total/i,
  debit: /debit|withdraw|paid out|money out|outflow|spent/i,
  credit: /credit|deposit|paid in|money in|inflow|received/i,
};

export interface GuessedMapping {
  mapping: ImportMapping;
  /** Formats that fit the date column; more than one means the user must choose. */
  dateFormats: DateFormat[];
}

/** Best guess from header names first, then from what the columns contain. Null if no date/amount column fits. */
export function guessMapping(rows: string[][], currency = "USD"): GuessedMapping | null {
  const first = rows[0] ?? [];
  const width = Math.max(...rows.map((r) => r.length), 0);
  const looksLikeHeader =
    first.length > 0 && first.every((cell) => parseImportAmount(cell, currency) === null);
  const header = looksLikeHeader ? first : [];
  const body = (looksLikeHeader ? rows.slice(1) : rows).slice(0, 50);
  const column = (i: number) => body.map((r) => r[i] ?? "").filter((v) => v.trim() !== "");
  const columns = Array.from({ length: width }, (_, i) => i);
  const byHeader = (hint: RegExp) => columns.find((i) => hint.test(header[i] ?? ""));

  const dateColumn =
    byHeader(HEADER_HINTS.date) ??
    columns.find((i) => column(i).length > 0 && detectDateFormats(column(i)).length > 0);
  if (dateColumn === undefined) return null;
  // Formats are judged on EVERY row, not just the sample: "11/01" is ambiguous,
  // but a "11/13" further down proves the file is month-first.
  const dateFormats = detectDateFormats(
    (looksLikeHeader ? rows.slice(1) : rows).map((r) => r[dateColumn] ?? ""),
  );

  const isNumeric = (i: number) =>
    i !== dateColumn &&
    column(i).length > 0 &&
    column(i).every((v) => parseImportAmount(v, currency) !== null);

  const debit = byHeader(HEADER_HINTS.debit);
  const credit = byHeader(HEADER_HINTS.credit);
  let amount: AmountMapping | null = null;
  const single = byHeader(HEADER_HINTS.amount);
  if (single !== undefined && single !== debit && single !== credit) {
    amount = { type: "single", column: single, negate: false };
  } else if (debit !== undefined && credit !== undefined) {
    amount = { type: "split", debitColumn: debit, creditColumn: credit };
  } else {
    const numeric = columns.find(isNumeric);
    if (numeric !== undefined) amount = { type: "single", column: numeric, negate: false };
  }
  if (!amount) return null;

  const used = new Set([
    dateColumn,
    ...(amount.type === "single" ? [amount.column] : [amount.debitColumn, amount.creditColumn]),
  ]);
  const descriptionColumn =
    byHeader(HEADER_HINTS.description) ??
    // Otherwise: the unused column with the longest text on average.
    columns
      .filter((i) => !used.has(i))
      .sort(
        (a, b) =>
          column(b).join("").length / (column(b).length || 1) -
          column(a).join("").length / (column(a).length || 1),
      )[0] ??
    0;

  return {
    mapping: {
      hasHeader: looksLikeHeader,
      dateColumn,
      dateFormat: dateFormats[0] ?? "YMD",
      descriptionColumn,
      amount,
    },
    dateFormats,
  };
}

// ─── Applying a mapping ──────────────────────────────────────────────────────

/** One CSV row → a transaction-shaped value, or the reason it can't be imported. */
export function applyMapping(row: string[], mapping: ImportMapping, currency = "USD"): MappedRow {
  const rawDate = row[mapping.dateColumn] ?? "";
  const occurredOn = parseImportDate(rawDate, mapping.dateFormat);
  if (!occurredOn) return { ok: false, error: `Unreadable date "${rawDate.slice(0, 30)}"` };

  const description = (row[mapping.descriptionColumn] ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 200);
  if (!description) return { ok: false, error: "Missing description" };

  let amountMinor: number | null;
  if (mapping.amount.type === "single") {
    const raw = row[mapping.amount.column] ?? "";
    amountMinor = parseImportAmount(raw, currency);
    if (amountMinor !== null && mapping.amount.negate) amountMinor = -amountMinor;
  } else {
    const out = parseImportAmount(row[mapping.amount.debitColumn] ?? "", currency);
    const inn = parseImportAmount(row[mapping.amount.creditColumn] ?? "", currency);
    amountMinor = out === null && inn === null ? null : (inn ?? 0) - Math.abs(out ?? 0);
  }
  if (amountMinor === null) return { ok: false, error: "Unreadable amount" };
  if (amountMinor === 0) return { ok: false, error: "Zero amount" };
  return { ok: true, occurredOn, description, amountMinor };
}
