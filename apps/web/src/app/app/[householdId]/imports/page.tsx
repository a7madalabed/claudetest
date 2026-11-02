import type { Metadata } from "next";
import { ImportsView } from "@/components/imports/imports-view";

export const metadata: Metadata = { title: "Imports" };

export default async function ImportsPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  return <ImportsView householdId={householdId} />;
}
