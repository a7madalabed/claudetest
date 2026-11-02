"use client";

import { Sparkles } from "lucide-react";
import { Page } from "@/components/app-shell/page";
import { Card } from "@/components/ui/card";
import { useAccounts, useCategories, useRecentTransactions } from "@/lib/query/hooks";
import { TransactionList } from "./overview";

/** Stage 6 shows the latest 25; Stage 7 replaces this with the full experience. */
export function TransactionsPreview({ householdId }: { householdId: string }) {
  const recent = useRecentTransactions(householdId, 25);
  const categories = useCategories(householdId);
  const accounts = useAccounts(householdId);

  return (
    <Page title="Transactions" description="Your latest activity across all accounts.">
      <div className="mb-5 flex items-start gap-3 rounded-2xl bg-primary-subtle p-4 text-sm text-primary">
        <Sparkles className="mt-0.5 size-4 shrink-0" />
        <p>
          Coming in Stage 7: infinite scrolling, search and filters, a fast keyboard-friendly table,
          and adding or editing transactions with instant (optimistic) updates.
        </p>
      </div>
      <Card>
        <TransactionList
          transactions={recent.data?.data}
          categories={categories.data}
          accounts={accounts.data}
        />
      </Card>
    </Page>
  );
}
