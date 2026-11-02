import { addMonths, monthDiff, toYearMonth, type YearMonth } from "./months.js";

export type GoalStatus = "reached" | "on_track" | "behind" | "no_progress" | "no_deadline";

export interface GoalProjection {
  progress: number;
  remainingMinor: number;
  /** Average monthly change of the account over recent months. */
  monthlyPaceMinor: number;
  /** When the target would be reached at the current pace ("YYYY-MM"), if ever. */
  projectedMonth: YearMonth | null;
  /** What it would take per month to hit the target date. */
  requiredMonthlyMinor: number | null;
  status: GoalStatus;
}

/**
 * Projects a savings goal from the account's real history.
 *
 * Pace = the average month-over-month change of the account's month-end balance
 * over the last (up to) 6 months. An average, not a single month, because one
 * big purchase or bonus shouldn't swing the forecast wildly.
 */
export function projectGoal(input: {
  balanceMinor: number;
  targetMinor: number;
  targetDate: string | null;
  /** Balances at the end of recent COMPLETED months, oldest first. */
  monthEndBalances: number[];
  today: string;
}): GoalProjection {
  const remainingMinor = Math.max(0, input.targetMinor - input.balanceMinor);
  const progress = Math.max(0, Math.min(1, input.balanceMinor / input.targetMinor));

  const recent = input.monthEndBalances.slice(-7);
  const changes = recent.slice(1).map((value, i) => value - recent[i]!);
  const monthlyPaceMinor = changes.length
    ? Math.round(changes.reduce((a, b) => a + b, 0) / changes.length)
    : 0;

  const thisMonth = toYearMonth(input.today);
  const monthsLeft = input.targetDate ? monthDiff(thisMonth, toYearMonth(input.targetDate)) : null;
  const requiredMonthlyMinor =
    monthsLeft !== null && remainingMinor > 0
      ? Math.ceil(remainingMinor / Math.max(1, monthsLeft))
      : null;

  if (remainingMinor === 0) {
    return {
      progress: 1,
      remainingMinor,
      monthlyPaceMinor,
      projectedMonth: thisMonth,
      requiredMonthlyMinor: null,
      status: "reached",
    };
  }
  if (monthlyPaceMinor <= 0) {
    return {
      progress,
      remainingMinor,
      monthlyPaceMinor,
      projectedMonth: null,
      requiredMonthlyMinor,
      status: "no_progress",
    };
  }
  const projectedMonth = addMonths(thisMonth, Math.ceil(remainingMinor / monthlyPaceMinor));
  const status: GoalStatus =
    input.targetDate === null
      ? "no_deadline"
      : projectedMonth <= toYearMonth(input.targetDate)
        ? "on_track"
        : "behind";
  return {
    progress,
    remainingMinor,
    monthlyPaceMinor,
    projectedMonth,
    requiredMonthlyMinor,
    status,
  };
}
