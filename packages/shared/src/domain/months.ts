/** Calendar-month helpers on "YYYY-MM" strings (no time zones, no Date pitfalls). */
export type YearMonth = string;

export const toYearMonth = (isoDate: string): YearMonth => isoDate.slice(0, 7);

export function addMonths(month: YearMonth, count: number): YearMonth {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function monthDiff(from: YearMonth, to: YearMonth): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/** Every month from `from` to `to`, inclusive. */
export function monthsBetween(from: YearMonth, to: YearMonth): YearMonth[] {
  const count = monthDiff(from, to);
  return count < 0 ? [] : Array.from({ length: count + 1 }, (_, i) => addMonths(from, i));
}

/**
 * Today's date in a time zone ("2026-11-02"). Background jobs have no browser to
 * ask, so they use the household's zone: at 11 pm in Los Angeles on Oct 31,
 * UTC says November but the household is still in October.
 */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
