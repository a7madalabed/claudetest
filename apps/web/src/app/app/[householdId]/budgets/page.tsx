import type { Metadata } from "next";
import { Suspense } from "react";
import { BudgetsView } from "@/components/budgets/budgets-view";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  // The month switcher keeps ?month= in the URL (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <BudgetsView householdId={householdId} />
    </Suspense>
  );
}
