"use client";

import type { AccountDto } from "@ledgerly/shared";
import { motion } from "motion/react";
import { Page } from "@/components/app-shell/page";
import { AnimatedMoney } from "@/components/money";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fadeUp, stagger } from "@/lib/motion";
import { useAccounts } from "@/lib/query/hooks";
import { accountIcons } from "./overview";

const groups: Array<{ label: string; types: AccountDto["type"][] }> = [
  { label: "Cash & bank", types: ["checking", "savings", "cash"] },
  { label: "Credit", types: ["credit_card", "loan"] },
  { label: "Investments", types: ["investment"] },
];

const typeLabel: Record<AccountDto["type"], string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  cash: "Cash",
  investment: "Investment",
  loan: "Loan",
};

export function AccountsView({ householdId }: { householdId: string }) {
  const { data: accounts, isPending } = useAccounts(householdId);

  return (
    <Page title="Accounts" description="Balances update the moment a transaction is recorded.">
      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map((group) => {
            const items = accounts?.filter((a) => group.types.includes(a.type)) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={group.label} aria-labelledby={`group-${group.label}`}>
                <h2
                  id={`group-${group.label}`}
                  className="mb-3 text-sm font-medium text-muted-foreground"
                >
                  {group.label}
                </h2>
                <motion.ul
                  variants={stagger(0.05)}
                  initial="hidden"
                  animate="visible"
                  className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {items.map((account) => {
                    const Icon = accountIcons[account.type];
                    return (
                      <motion.li key={account.id} variants={fadeUp}>
                        <Card className="group p-5 transition-shadow hover:shadow-elevation-2">
                          <div className="flex items-center gap-3">
                            <span className="flex size-10 items-center justify-center rounded-xl bg-primary-subtle text-primary">
                              <Icon className="size-5" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium">{account.name}</p>
                              <p className="text-caption text-muted-foreground">
                                {typeLabel[account.type]} · {account.currency}
                              </p>
                            </div>
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
          })}
        </div>
      )}
    </Page>
  );
}
