import { addMonths, type BudgetStatus, type YearMonth } from "@ledgerly/shared";

/*
 * "Today" and "this month" come from the USER's clock, not the server's: at
 * 11pm on the 31st in California it's already the 1st in UTC, and a budget
 * page that jumped to next month would be wrong. The API takes the month as a
 * parameter for exactly this reason.
 */
const pad = (n: number) => String(n).padStart(2, "0");

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
