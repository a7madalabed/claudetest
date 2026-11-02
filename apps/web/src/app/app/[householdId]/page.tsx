import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  // The trends range lives in the URL (useSearchParams), which needs a Suspense boundary.
  return (
    <Suspense>
      <Dashboard householdId={householdId} />
    </Suspense>
  );
}
