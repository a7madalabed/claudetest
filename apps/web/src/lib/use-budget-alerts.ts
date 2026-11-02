"use client";

import { STATUS_RANK, type BudgetStatus } from "@ledgerly/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { fullMoney } from "@/components/charts/format";
import { localMonth } from "./budgets";
import { useBudgets } from "./query/budgets";

/**
 * Budget alerts, computed on the CLIENT from data we already fetch:
 *
 *  - Toast when a budget's status gets WORSE during this session (ok → warning,
 *    warning → over). The first load only records a baseline — nobody wants a
 *    pile of toasts every time they open the app.
 *  - Return the number of budgets over their limit, for the nav badge.
 *
 * When does a status change? When a transaction is added, edited or deleted —
 * those mutations invalidate the household's queries, the budgets refetch, and
 * this effect compares old and new statuses.
 *
 * (Stage 10 adds server-side notifications, e.g. email, via background jobs.)
 */
export function useBudgetAlerts(householdId: string | undefined, currency: string) {
  const router = useRouter();
  const month = localMonth();
  const { data } = useBudgets(householdId ?? "", month, { enabled: Boolean(householdId) });
  const seen = useRef<{ scope: string; statuses: Map<string, BudgetStatus> } | null>(null);

  useEffect(() => {
    if (!data || !householdId || data.month !== month) return;
    const scope = `${householdId}:${month}`;
    const previous = seen.current?.scope === scope ? seen.current.statuses : null;

    if (previous) {
      for (const budget of data.budgets) {
        const before = previous.get(budget.id);
        if (before === undefined || STATUS_RANK[budget.status] <= STATUS_RANK[before]) continue;
        const description = `${fullMoney(budget.spentMinor, currency)} of ${fullMoney(budget.availableMinor, currency)} spent this month`;
        const action = {
          label: "View",
          onClick: () => router.push(`/app/${householdId}/budgets`),
        };
        if (budget.status === "over") {
          toast.error(`${budget.name} is over budget`, { description, action });
        } else {
          toast.warning(`${budget.name} is close to its limit`, { description, action });
        }
      }
    }
    seen.current = { scope, statuses: new Map(data.budgets.map((b) => [b.id, b.status])) };
  }, [data, householdId, month, currency, router]);

  return data?.budgets.filter((b) => b.status === "over").length ?? 0;
}
