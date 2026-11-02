import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/api/me";

/**
 * Every page under /app/<householdId> first checks the user belongs to that
 * household (getMe is cached, so this costs nothing extra). The API enforces
 * this too — this check just gives a proper 404 page instead of broken widgets.
 */
export default async function HouseholdLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const me = await getMe();
  if (!me.households.some((h) => h.id === householdId)) notFound();
  return children;
}
