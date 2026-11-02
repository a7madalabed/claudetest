"use client";

import type { NotificationDto } from "@ledgerly/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { localMonth } from "./budgets";
import { useBudgets } from "./query/budgets";
import { useNotifications } from "./query/automation";

/** How many budgets are over their limit this month — for the nav badge. */
export function useOverBudgetCount(householdId: string | undefined) {
  const { data } = useBudgets(householdId ?? "", localMonth(), { enabled: Boolean(householdId) });
  return data?.budgets.filter((b) => b.status === "over").length ?? 0;
}

const toastFor = (kind: string) =>
  kind === "budget.over" || kind.endsWith(".failed")
    ? toast.error
    : kind === "budget.warning"
      ? toast.warning
      : toast.success;

/**
 * Shows a toast when a NEW notification arrives while the app is open.
 *
 * In Stage 9 the browser compared budget statuses itself, so only the person
 * who made the change saw an alert, and only in that tab. Now the SERVER decides
 * (a background job, once per event) and every member gets the same
 * notification — in the bell, by email, and as a toast if they're online.
 *
 * The first load just records what's already there: old news isn't a toast.
 */
export function useNotificationToasts() {
  const router = useRouter();
  const { data } = useNotifications();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!data) return;
    if (seen.current) {
      const fresh = data.data.filter((n) => !n.readAt && !seen.current!.has(n.id));
      for (const n of fresh.slice(0, 3).reverse()) {
        toastFor(n.kind)(n.title, {
          description: n.body,
          ...(n.link && { action: { label: "View", onClick: () => router.push(n.link!) } }),
        });
      }
    }
    seen.current = new Set(data.data.map((n: NotificationDto) => n.id));
  }, [data, router]);
}
