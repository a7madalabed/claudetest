import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { yearMonth } from "../test/arbitraries.js";
import {
  STATUS_RANK,
  amountForMonth,
  budgetStatus,
  computeBudgetMonth,
  type BudgetAmountChange,
} from "./budgets.js";
import { addMonths, monthsBetween } from "./months.js";

const money = fc.integer({ min: 0, max: 10_000_000 }); // up to $100k a month, in cents

/** A budget's history: a start month, amount changes after it, and spending each month. */
const budgetHistory = fc
  .record({
    start: yearMonth,
    length: fc.integer({ min: 0, max: 36 }),
    firstAmount: money,
    changes: fc.array(fc.record({ offset: fc.integer({ min: 1, max: 36 }), amount: money }), {
      maxLength: 5,
    }),
    spending: fc.array(money, { minLength: 37, maxLength: 37 }),
  })
  .map(({ start, length, firstAmount, changes, spending }) => {
    // One change per month at most (the API upserts on (budget, effective_month)).
    const byMonth = new Map([[start, firstAmount]]);
    for (const c of changes) byMonth.set(addMonths(start, c.offset), c.amount);
    const amounts: BudgetAmountChange[] = [...byMonth].map(([m, amountMinor]) => ({
      effectiveMonth: `${m}-01`,
      amountMinor,
    }));
    const months = monthsBetween(start, addMonths(start, length));
    const spentByMonth = new Map(months.map((m, i) => [m, spending[i]!]));
    return { start, amounts, months, spentByMonth };
  });

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("budget properties", () => {
  it("with rollover, nothing is created or lost: remaining = everything budgeted − everything spent", () => {
    fc.assert(
      fc.property(budgetHistory, ({ start, amounts, months, spentByMonth }) => {
        const month = months.at(-1)!;
        const result = computeBudgetMonth({
          startMonth: `${start}-01`,
          amounts,
          rollover: true,
          spentByMonth,
          month,
        })!;
        const budgeted = sum(months.map((m) => amountForMonth(amounts, m) ?? 0));
        const spent = sum(months.map((m) => spentByMonth.get(m) ?? 0));
        expect(result.remainingMinor).toBe(budgeted - spent);
        expect(result.availableMinor).toBe(result.amountMinor + result.rolloverMinor);
      }),
    );
  });

  it("without rollover, each month stands alone", () => {
    fc.assert(
      fc.property(budgetHistory, ({ start, amounts, months, spentByMonth }) => {
        const month = months.at(-1)!;
        const result = computeBudgetMonth({
          startMonth: `${start}-01`,
          amounts,
          rollover: false,
          spentByMonth,
          month,
        })!;
        expect(result.rolloverMinor).toBe(0);
        expect(result.availableMinor).toBe(amountForMonth(amounts, month));
      }),
    );
  });

  it("the amount in force is the latest change on or before the month, whatever the input order", () => {
    fc.assert(
      fc.property(budgetHistory, fc.integer({ min: 0, max: 36 }), (history, offset) => {
        const month = addMonths(history.start, offset);
        const latest = history.amounts
          .filter((a) => a.effectiveMonth.slice(0, 7) <= month)
          .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth))
          .at(-1);
        const shuffled = [...history.amounts].reverse();
        expect(amountForMonth(shuffled, month)).toBe(latest?.amountMinor ?? null);
        expect(amountForMonth(shuffled, addMonths(history.start, -1))).toBeNull();
      }),
    );
  });

  it("spending more never makes the status look better", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        money,
        money,
        (available, a, b) => {
          const [less, more] = a <= b ? [a, b] : [b, a];
          expect(STATUS_RANK[budgetStatus(more, available)]).toBeGreaterThanOrEqual(
            STATUS_RANK[budgetStatus(less, available)],
          );
        },
      ),
    );
  });
});
