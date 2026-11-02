"use client";

import type { AccountDto, CategoryDto, TransactionDto } from "@ledgerly/shared";
import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Landmark,
  PiggyBank,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { Amount } from "@/components/money";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryIcon } from "@/lib/category-icons";
import { formatDay } from "@/lib/dates";
import { fadeUp, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Shared pieces used by the dashboard and the accounts page. */
export const accountIcons: Record<AccountDto["type"], LucideIcon> = {
  checking: Landmark,
  savings: PiggyBank,
  credit_card: CreditCard,
  cash: Banknote,
  investment: TrendingUp,
  loan: Wallet,
};

export function TransactionList({
  transactions,
  categories,
  accounts,
}: {
  transactions?: TransactionDto[];
  categories?: CategoryDto[];
  accounts?: AccountDto[];
}) {
  const categoryById = useMemo(() => new Map(categories?.map((c) => [c.id, c])), [categories]);
  const parentOf = (c: CategoryDto | undefined) => (c?.parentId ? categoryById.get(c.parentId) : c);
  const currencyOf = useMemo(() => new Map(accounts?.map((a) => [a.id, a.currency])), [accounts]);

  if (!transactions) {
    return (
      <div className="space-y-3 p-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }
  if (transactions.length === 0) {
    return (
      <p className="px-5 pb-8 pt-4 text-center text-sm text-muted-foreground">
        No transactions yet.
      </p>
    );
  }

  return (
    <motion.ul variants={stagger(0.03)} initial="hidden" animate="visible" className="px-2 pb-2">
      {transactions.map((t) => {
        const category = t.categoryId ? categoryById.get(t.categoryId) : undefined;
        return (
          <motion.li
            key={t.id}
            variants={fadeUp}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/50"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              {t.transferId ? (
                <ArrowLeftRight className="size-4" />
              ) : (
                <CategoryIcon name={parentOf(category)?.icon} className="size-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t.description}</span>
              <span className="block text-caption text-muted-foreground">
                {formatDay(t.occurredOn)} ·{" "}
                {t.transferId ? "Transfer" : (category?.name ?? "Uncategorised")}
              </span>
            </span>
            <Amount
              value={t.amountMinor}
              currency={currencyOf.get(t.accountId) ?? "USD"}
              className={cn("text-sm", t.transferId && "!text-muted-foreground")}
            />
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
