import type { Metadata } from "next";
import { Suspense } from "react";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  // useSearchParams() (filters in the URL) must sit inside a Suspense boundary.
  return (
    <Suspense>
      <TransactionsView householdId={householdId} />
    </Suspense>
  );
}
