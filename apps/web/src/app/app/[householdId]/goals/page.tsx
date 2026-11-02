import type { Metadata } from "next";
import { GoalsView } from "@/components/goals/goals-view";

export const metadata: Metadata = { title: "Goals" };

export default async function GoalsPage({ params }: { params: Promise<{ householdId: string }> }) {
  const { householdId } = await params;
  return <GoalsView householdId={householdId} />;
}
