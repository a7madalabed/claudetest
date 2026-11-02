import type { Metadata } from "next";
import { AccountsView } from "@/components/overview/accounts-view";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  return <AccountsView householdId={householdId} />;
}
