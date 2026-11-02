"use client";

import type { HouseholdDto } from "@ledgerly/shared";
import { useParams } from "next/navigation";
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
