"use client";

import type { AccountDto } from "@ledgerly/shared";
import { Pencil, Plus } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { useCurrentHousehold } from "@/components/app-shell/household-context";
import { Page } from "@/components/app-shell/page";
import { AnimatedMoney } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, loadFailed } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { fadeUp, stagger } from "@/lib/motion";
import { useAllAccounts } from "@/lib/query/accounts";
import { useNewParam } from "@/lib/use-new-param";
import { AccountDialog, ACCOUNT_TYPES } from "./account-dialog";
import { NoAccountsNotice } from "./no-accounts";
import { accountIcons } from "./overview";

const groups: Array<{ label: string; types: AccountDto["type"][] }> = [
  { label: "Cash & bank", types: ["checking", "savings", "cash"] },
  { label: "Credit", types: ["credit_card", "loan"] },
  { label: "Investments", types: ["investment"] },
];

const typeLabel = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.value, t.label])) as Record<
  AccountDto["type"],
  string
>;

type DialogState = { open: false } | { open: true; account: AccountDto | null };

export function AccountsView({ householdId }: { householdId: string }) {
  const household = useCurrentHousehold();
  const canEdit = household !== undefined && household.role !== "viewer";
  const query = useAllAccounts(householdId);
  const { data: accounts, isPending } = query;
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  // "Add an account" links from elsewhere (and ⌘K) arrive with ?new=1.
  useNewParam(() => canEdit && setDialog({ open: true, account: null }));

  const active = accounts?.filter((a) => !a.archived) ?? [];
  const archived = accounts?.filter((a) => a.archived) ?? [];
  const edit = canEdit ? (account: AccountDto) => setDialog({ open: true, account }) : undefined;

  return (
    <Page
      title="Accounts"
      description="Balances update the moment a transaction is recorded."
      actions={
        canEdit && (
          <Button onClick={() => setDialog({ open: true, account: null })}>
            <Plus /> Add account
          </Button>
        )
      }
    >
      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : loadFailed(query) ? (
        <ErrorState onRetry={query.refetch} title="Couldn't load this" />
      ) : active.length === 0 && archived.length === 0 ? (
        <NoAccountsNotice householdId={householdId} canEdit={canEdit} title="No accounts yet">
          Add each place your money lives — a bank account, a card, a cash wallet, a loan. Then
          record transactions or import a bank statement into it.
        </NoAccountsNotice>
      ) : (
        <div className="space-y-10">
          {groups.map((group) => (
            <AccountGroup
              key={group.label}
              label={group.label}
              accounts={active.filter((a) => group.types.includes(a.type))}
              onEdit={edit}
            />
          ))}
          <AccountGroup label="Archived" accounts={archived} onEdit={edit} muted />
        </div>
      )}

      {household && (
        <AccountDialog
          open={dialog.open}
          onOpenChange={(open) => !open && setDialog({ open: false })}
          householdId={householdId}
          currency={household.baseCurrency}
          account={dialog.open ? dialog.account : null}
        />
      )}
    </Page>
  );
}

function AccountGroup({
  label,
  accounts,
  onEdit,
  muted = false,
}: {
  label: string;
  accounts: AccountDto[];
  onEdit?: (account: AccountDto) => void;
  muted?: boolean;
}) {
  if (accounts.length === 0) return null;
  const headingId = `group-${label.replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-sm font-medium text-muted-foreground">
        {label}
      </h2>
      <motion.ul
        variants={stagger(0.05)}
        initial="hidden"
        animate="visible"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {accounts.map((account) => {
          const Icon = accountIcons[account.type];
          return (
            <motion.li key={account.id} variants={fadeUp}>
              <Card
                className={`group p-5 transition-shadow hover:shadow-elevation-2 ${muted ? "opacity-70" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{account.name}</p>
                    <p className="text-caption text-muted-foreground">
                      {typeLabel[account.type]} · {account.currency}
                    </p>
                  </div>
                  {muted && <Badge tone="neutral">Archived</Badge>}
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(account)}
                      aria-label={`Edit ${account.name}`}
                    >
                      <Pencil />
                    </Button>
                  )}
                </div>
                <AnimatedMoney
                  value={account.balanceMinor}
                  currency={account.currency}
                  className={`mt-5 block text-2xl font-semibold tracking-tight ${account.balanceMinor < 0 ? "text-negative" : ""}`}
                />
              </Card>
            </motion.li>
          );
        })}
      </motion.ul>
    </section>
  );
}
