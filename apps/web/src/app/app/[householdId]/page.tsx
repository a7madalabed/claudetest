import type { Metadata } from "next";
import { Overview } from "@/components/overview/overview";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  return <Overview householdId={householdId} />;
}
