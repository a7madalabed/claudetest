/*
 * The dashboard's arithmetic, as pure functions: easy to test, and no maths
 * hidden inside JSX. All dates are "YYYY-MM-DD" calendar days in the user's
 * local calendar (Stage 3 §5.4).
 */

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const daysInMonth = (year: number, monthIndex: number) =>
  new Date(year, monthIndex + 1, 0).getDate();

/** This month and last month as half-open ranges, plus "today" as a day-of-month. */
export function monthWindows(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    thisMonth: { from: isoDay(new Date(y, m, 1)), to: isoDay(new Date(y, m + 1, 1)) },
    lastMonth: { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 1)) },
    /** Both months together — one request for the daily data. */
    both: { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m + 1, 1)) },
    today: now.getDate(),
    daysThisMonth: daysInMonth(y, m),
    daysLastMonth: daysInMonth(y, m - 1),
  };
}

type Day = { date: string; incomeMinor: number; spendingMinor: number };

/**
 * Month-to-date totals compared with THE SAME DAYS of last month. Comparing the
 * first week of November with all of October would make every number look like
 * a huge drop — an honest comparison uses the same window.
 */
export function monthToDate(days: Day[], now = new Date()) {
  const w = monthWindows(now);
  const sameDayLastMonth = Math.min(w.today, w.daysLastMonth);
  const sum = (from: string, toDay: number, key: "incomeMinor" | "spendingMinor") =>
    days
      .filter(
        (d) =>
          d.date >= from &&
          d.date.slice(0, 7) === from.slice(0, 7) &&
          Number(d.date.slice(8)) <= toDay,
      )
      .reduce((total, d) => total + d[key], 0);
  const current = {
    income: sum(w.thisMonth.from, w.today, "incomeMinor"),
    spending: sum(w.thisMonth.from, w.today, "spendingMinor"),
  };
  const previous = {
    income: sum(w.lastMonth.from, sameDayLastMonth, "incomeMinor"),
    spending: sum(w.lastMonth.from, sameDayLastMonth, "spendingMinor"),
  };
  return { current, previous };
}

/** Relative change, or null when there's nothing to compare against. */
export const relativeChange = (current: number, previous: number) =>
  previous === 0 ? null : (current - previous) / Math.abs(previous);

/** Share of income kept: (income − spending) / income. Null with no income. */
export const savingsRate = (income: number, spending: number) =>
  income <= 0 ? null : (income - spending) / income;

/**
 * Cumulative spending by day-of-month, this month vs last month, for the pace
 * chart. Future days of this month are null, so the line stops at "today".
 */
export function spendingPace(days: Day[], now = new Date()) {
  const w = monthWindows(now);
  const length = Math.max(w.daysThisMonth, w.daysLastMonth);
  const perDay = (from: string) => {
    const totals = new Array<number>(length + 1).fill(0);
    for (const d of days)
      if (d.date.slice(0, 7) === from.slice(0, 7))
        totals[Number(d.date.slice(8))]! += d.spendingMinor;
    return totals;
  };
  const current = perDay(w.thisMonth.from);
  const previous = perDay(w.lastMonth.from);
  let runThis = 0;
  let runLast = 0;
  return Array.from({ length }, (_, i) => {
    const day = i + 1;
    runThis += current[day]!;
    runLast += previous[day]!;
    return {
      day,
      thisMonth: day <= Math.min(w.today, w.daysThisMonth) ? runThis : null,
      lastMonth: day <= w.daysLastMonth ? runLast : null,
    };
  });
}

export const TREND_RANGES = {
  "3m": "3 months",
  "6m": "6 months",
  "12m": "12 months",
  ytd: "Year to date",
} as const;
export type TrendRange = keyof typeof TREND_RANGES;

/** [first day of the first month, first day of next month) for the trends section. */
export function trendRange(range: TrendRange, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const months = { "3m": 3, "6m": 6, "12m": 12, ytd: m + 1 }[range];
  return { from: isoDay(new Date(y, m - months + 1, 1)), to: isoDay(new Date(y, m + 1, 1)) };
}
