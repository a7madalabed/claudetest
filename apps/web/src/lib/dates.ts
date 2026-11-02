/**
 * Dates from the API are calendar days ("2026-03-14"), not moments (Stage 3 §5.4).
 * We format them in UTC so a user in California never sees the 13th.
 */
const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

export const formatDay = (isoDate: string) => dayFormat.format(new Date(`${isoDate}T00:00:00Z`));
export const formatMonth = (yearMonth: string) =>
  monthFormat.format(new Date(`${yearMonth}-01T00:00:00Z`));

const pad = (n: number) => String(n).padStart(2, "0");

/** [first day of the month `monthsBack` months ago, first day of next month) — local calendar. */
export function monthRange(monthsBack = 0, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  return { from: iso(start), to: iso(end) };
}
