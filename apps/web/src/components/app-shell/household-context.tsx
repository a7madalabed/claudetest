"use client";

import type { HouseholdDto } from "@ledgerly/shared";
import { useParams } from "next/navigation";
import { householdNow } from "@/lib/budgets";
import { useMe } from "@/lib/query/hooks";

/**
 * The household the user is looking at. The URL is the source of truth
 * (/app/<householdId>/…), so links are shareable and the back button works.
 * Pages outside a household (settings) fall back to the first one.
 */
export function useCurrentHousehold(): HouseholdDto | undefined {
  const { householdId } = useParams<{ householdId?: string }>();
  const { data: me } = useMe();
  return me?.households.find((h) => h.id === householdId) ?? me?.households[0];
}

/**
 * "Now" as the CURRENT HOUSEHOLD's wall clock (Stage 17): what "today" and
 * "this month" mean on every page, for every member, wherever they are.
 * Pass it as `now` to the date helpers in lib/budgets and lib/dashboard.
 */
export function useHouseholdNow(): Date {
  return householdNow(useCurrentHousehold()?.timeZone);
}
