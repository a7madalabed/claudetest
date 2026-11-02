import type { Metadata } from "next";
import { TransactionsPreview } from "@/components/overview/transactions-preview";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  return <TransactionsPreview householdId={householdId} />;
}
