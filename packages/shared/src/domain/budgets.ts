import { monthsBetween, toYearMonth, type YearMonth } from "./months.js";

/*
 * Budget arithmetic. Pure functions: the API uses them to answer requests, and
 * the tests below pin down every rule — rollover especially, because "why does
 * it say I have $83 left?" must always have a precise answer.
 */

export type BudgetStatus = "ok" | "warning" | "over";

/** "Getting close" starts at 80% of what's available. */
export const BUDGET_WARNING_AT = 0.8;

export interface BudgetAmountChange {
  /** "YYYY-MM-01": the change applies from this month onward. */
  effectiveMonth: string;
  amountMinor: number;
}

/** The amount in force for a month: the latest change effective on or before it. */
export function amountForMonth(changes: BudgetAmountChange[], month: YearMonth): number | null {
  let amount: number | null = null;
  let latest = "";
  for (const change of changes) {
    const effective = toYearMonth(change.effectiveMonth);
    if (effective <= month && effective >= latest) {
      latest = effective;
      amount = change.amountMinor;
    }
  }
  return amount;
}

export function budgetStatus(spentMinor: number, availableMinor: number): BudgetStatus {
  if (availableMinor <= 0) return spentMinor > 0 || availableMinor < 0 ? "over" : "ok";
  const used = spentMinor / availableMinor;
  if (used > 1) return "over";
  if (used >= BUDGET_WARNING_AT) return "warning";
  return "ok";
}

export interface BudgetMonth {
  amountMinor: number;
  /** Carried in from previous months (negative = last month's overspend reduces this month). */
  rolloverMinor: number;
  availableMinor: number;
  spentMinor: number;
  remainingMinor: number;
  status: BudgetStatus;
}

/**
 * One budget for one month.
 *
 * Without rollover: available = this month's amount.
 * With rollover: walk forward from the budget's first month, carrying
 * (available − spent) each time — UNDERSPEND accumulates, OVERSPEND is paid back.
 */
export function computeBudgetMonth(input: {
  startMonth: string;
  amounts: BudgetAmountChange[];
  rollover: boolean;
  spentByMonth: ReadonlyMap<YearMonth, number>;
  month: YearMonth;
}): BudgetMonth | null {
  const start = toYearMonth(input.startMonth);
  if (input.month < start) return null; // the budget didn't exist yet

  let carry = 0;
  if (input.rollover) {
    for (const month of monthsBetween(start, input.month).slice(0, -1)) {
      const amount = amountForMonth(input.amounts, month) ?? 0;
      carry = amount + carry - (input.spentByMonth.get(month) ?? 0);
    }
  }

  const amountMinor = amountForMonth(input.amounts, input.month) ?? 0;
  const availableMinor = amountMinor + carry;
  const spentMinor = input.spentByMonth.get(input.month) ?? 0;
  return {
    amountMinor,
    rolloverMinor: carry,
    availableMinor,
    spentMinor,
    remainingMinor: availableMinor - spentMinor,
    status: budgetStatus(spentMinor, availableMinor),
  };
}

/** Status only ever gets "worse" in this order — used to detect alerts worth showing. */
export const STATUS_RANK: Record<BudgetStatus, number> = { ok: 0, warning: 1, over: 2 };
