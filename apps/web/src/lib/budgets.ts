import { addMonths, type BudgetStatus, type YearMonth } from "@ledgerly/shared";

/*
 * "Today" and "this month" are the HOUSEHOLD's (Stage 17): at 11pm on the 31st
 * in California it's already the 1st in UTC, and a budget page that jumped to
 * next month would be wrong. Before Stage 17 the browser's clock decided, so
 * two members in different zones, the server's alerts and the budget page
 * could each be in a different month. Now everyone uses the household's zone
 * (as the API does): pass `householdNow(timeZone)` as `now` below.
 */
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "Now" as the household's wall clock: a Date whose LOCAL fields (getDate(),
 * getMonth()…) read the date and time in `timeZone`, so the helpers below,
 * which read local fields, work unchanged. Use it for calendar maths only,
 * never as a real instant (to store or send).
 */
export function householdNow(timeZone: string | undefined, now = new Date()): Date {
  if (!timeZone) return now;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export const localMonth = (now = new Date()): YearMonth =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

const monthYear = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
export const formatMonthYear = (month: YearMonth) =>
  monthYear.format(new Date(`${month}-01T00:00:00Z`));

/**
 * How far through `month` we are (0–1): 1 for past months, 0 for future ones.
 * Comparing "share of budget spent" with "share of month gone" is the most
 * useful single signal a budget can give ("62% spent, 48% of the month gone").
 */
export function monthElapsed(month: YearMonth, now = new Date()) {
  const current = localMonth(now);
  if (month < current) return 1;
  if (month > current) return 0;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() / days;
}

export const isValidMonth = (value: string | null): value is YearMonth =>
  !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export const shiftMonth = addMonths;

export const STATUS_LABEL: Record<BudgetStatus, string> = {
  ok: "On track",
  warning: "Close to limit",
  over: "Over budget",
};

/** Status colours are RESERVED for state — never reused for a chart series. */
export const STATUS_COLOR: Record<BudgetStatus, string> = {
  ok: "var(--positive)",
  warning: "var(--warning)",
  over: "var(--negative)",
};
