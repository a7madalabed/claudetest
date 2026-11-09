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

/** The day after an ISO date: "2026-11-30" → "2026-12-01". */
export function dayAfter(isoDate: string): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Stops a [from, to) range at the end of `today` (Stage 19: everything is "as of
 * today"). Entries dated after today haven't happened yet, so no balance, total
 * or chart counts them. `to` is exclusive, so "through today" means "before
 * tomorrow". A range that already ends today or earlier is returned unchanged.
 */
export function throughToday<R extends { from: string; to: string }>(range: R, today: string): R {
  const end = dayAfter(today);
  return range.to > end ? { ...range, to: end } : range;
}
