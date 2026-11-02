import { eq, households } from "@ledgerly/db";
import { formatMoney, todayIn, toYearMonth } from "@ledgerly/shared";
import { z } from "zod";
import { defineJob } from "../../jobs/registry.js";
import { notify } from "../notifications/notifications.service.js";
import { getBudgetMonth } from "./budgets.service.js";

const monthName = (month: string) =>
  new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

/**
 * Plain words, even in odd cases. A rollover budget can start a month BELOW zero
 * (earlier overspending is paid back first), and "$61 of −$36,609 spent" means
 * nothing to a person — so say what actually happened.
 */
export function alertBody(
  budget: { spentMinor: number; availableMinor: number; rolloverMinor: number },
  month: string,
  currency: string,
) {
  const money = (minor: number) => formatMoney(minor, currency);
  if (budget.availableMinor <= 0) {
    return `${money(budget.spentMinor)} spent in ${month}, with ${money(-budget.rolloverMinor)} of earlier overspending still carried over.`;
  }
  return `${money(budget.spentMinor)} of ${money(budget.availableMinor)} spent in ${month}.`;
}

/**
 * Queued by a DATABASE TRIGGER whenever a household's transactions for the
 * current month change (see migration 0008). It recomputes the month's budgets
 * with the same pure maths as the Budgets page and notifies every member about
 * budgets that reached "warning" or "over" — once per budget, level and month,
 * thanks to the notification dedupe key.
 */
export const evaluateBudgetsJob = defineJob({
  name: "budgets.evaluate",
  payload: z.object({ householdId: z.uuid(), month: z.string().regex(/^\d{4}-\d{2}$/) }),
  run: async ({ householdId, month }, { db, log }) => {
    const [household] = await db
      .select({ timeZone: households.timeZone, currency: households.baseCurrency })
      .from(households)
      .where(eq(households.id, householdId));
    if (!household) return; // deleted since: nothing to do
    // The job may run just after midnight on the 1st: only the CURRENT month alerts.
    if (toYearMonth(todayIn(household.timeZone)) !== month) return;

    const view = await getBudgetMonth(db, householdId, month);
    let sent = 0;
    for (const budget of view.budgets) {
      if (budget.status === "ok") continue;
      const over = budget.status === "over";
      const created = await notify(db, {
        householdId,
        kind: `budget.${budget.status}`,
        title: over ? `${budget.name} is over budget` : `${budget.name} is close to its limit`,
        body: alertBody(budget, monthName(month), household.currency),
        link: `/app/${householdId}/budgets`,
        dedupeKey: `budget:${budget.id}:${month}:${budget.status}`,
        email: true,
      });
      sent += created.length;
    }
    log.info({ householdId, month, notifications: sent }, "Budgets evaluated");
  },
});
