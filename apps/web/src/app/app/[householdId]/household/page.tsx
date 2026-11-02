import type { Metadata } from "next";
import { HouseholdSettings } from "@/components/household/household-settings";

export const metadata: Metadata = { title: "Household" };

export default async function HouseholdPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  return <HouseholdSettings householdId={householdId} />;
}
