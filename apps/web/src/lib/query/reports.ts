"use client";

import {
  DailyCashflowReportSchema,
  DashboardLayoutSchema,
  NetWorthReportSchema,
  SpendingByCategoryReportSchema,
  type DashboardWidget,
} from "@ledgerly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../api/client";

type Range = { from: string; to: string };
const base = (householdId: string) => `/v1/households/${householdId}/reports`;
/** Keep the previous chart on screen (dimmed) while a new range loads — no skeleton flash. */
const keepPrevious = <T>(previous: T | undefined) => previous;

export function useNetWorth(householdId: string, range: Range) {
  return useQuery({
    queryKey: ["households", householdId, "reports", "net-worth", range],
    queryFn: ({ signal }) =>
      api(`${base(householdId)}/net-worth?from=${range.from}&to=${range.to}`, {
        schema: NetWorthReportSchema,
        signal,
      }),
    placeholderData: keepPrevious,
  });
}

export function useDailyCashflow(householdId: string, range: Range) {
  return useQuery({
    queryKey: ["households", householdId, "reports", "daily-cashflow", range],
    queryFn: ({ signal }) =>
      api(`${base(householdId)}/daily-cashflow?from=${range.from}&to=${range.to}`, {
        schema: DailyCashflowReportSchema,
        signal,
      }),
  });
}

export function useSpendingByCategory(householdId: string, range: Range, parentId?: string) {
  return useQuery({
    queryKey: [
      "households",
      householdId,
      "reports",
      "spending-by-category",
      range,
      parentId ?? null,
    ],
    queryFn: ({ signal }) =>
      api(
        `${base(householdId)}/spending-by-category?from=${range.from}&to=${range.to}${parentId ? `&parentId=${parentId}` : ""}`,
        {
          schema: SpendingByCategoryReportSchema,
          signal,
        },
      ),
    placeholderData: keepPrevious,
  });
}

const layoutKey = (householdId: string) => ["households", householdId, "dashboard"] as const;

export function useDashboardLayout(householdId: string) {
  return useQuery({
    queryKey: layoutKey(householdId),
    queryFn: ({ signal }) =>
      api(`/v1/households/${householdId}/dashboard`, { schema: DashboardLayoutSchema, signal }),
    staleTime: Infinity, // only this user changes it, and we update the cache ourselves
  });
}

/** Optimistic: the new order shows immediately; a failed save puts the old order back. */
export function useSaveDashboardLayout(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { handlesErrors: true },
    mutationFn: (widgets: DashboardWidget[]) =>
      api(`/v1/households/${householdId}/dashboard`, {
        method: "PUT",
        body: { widgets },
        schema: DashboardLayoutSchema,
      }),
    onMutate: (widgets) => {
      const previous = queryClient.getQueryData(layoutKey(householdId));
      queryClient.setQueryData(layoutKey(householdId), { widgets });
      return { previous };
    },
    onError: (_error, _widgets, context) => {
      queryClient.setQueryData(layoutKey(householdId), context?.previous);
      toast.error("Couldn't save your layout");
    },
  });
}
