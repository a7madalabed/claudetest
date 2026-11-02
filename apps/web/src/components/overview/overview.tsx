"use client";

import {
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  CreditCard,
  Landmark,
  PiggyBank,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useMemo } from "react";
import type { AccountDto, CategoryDto, TransactionDto } from "@ledgerly/shared";
import { useCurrentHousehold } from "@/components/app-shell/household-context";
import { Page } from "@/components/app-shell/page";
import { Amount, AnimatedMoney } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryIcon } from "@/lib/category-icons";
import { formatDay, formatMonth, monthRange } from "@/lib/dates";
import { fadeUp, spring, stagger } from "@/lib/motion";
import {
  useAccounts,
  useCashflow,
  useCategories,
  useMe,
  useRecentTransactions,
} from "@/lib/query/hooks";
import { cn } from "@/lib/utils";

export const accountIcons: Record<AccountDto["type"], LucideIcon> = {
  checking: Landmark,
  savings: PiggyBank,
  credit_card: CreditCard,
  cash: Banknote,
  investment: TrendingUp,
  loan: Wallet,
};

export function Overview({ householdId }: { householdId: string }) {
  const { data: me } = useMe();
  const household = useCurrentHousehold();
  const accounts = useAccounts(householdId);
  const thisMonth = useCashflow(householdId, monthRange(0));
  const sixMonths = useCashflow(householdId, monthRange(5));
  const recent = useRecentTransactions(householdId, 8);
  const categories = useCategories(householdId);

  const currency = household?.baseCurrency ?? "USD";
  const netWorth = accounts.data
    ?.filter((a) => a.currency === currency)
    .reduce((sum, a) => sum + a.balanceMinor, 0);
  const month = thisMonth.data?.months.at(-1);
  const firstName = me?.displayName.split(" ")[0];

  return (
    <Page title={`Welcome back${firstName ? `, ${firstName}` : ""}`} description={household?.name}>
      <motion.div
        variants={stagger(0.06)}
        initial="hidden"
        animate="visible"
        className="grid gap-5"
      >
        <div className="grid gap-5 md:grid-cols-3">
          <StatCard label="Net worth" value={netWorth} currency={currency} emphasis />
          <StatCard
            label="Income this month"
            value={month?.incomeMinor ?? (thisMonth.isSuccess ? 0 : undefined)}
            currency={currency}
            tone="positive"
          />
          <StatCard
            label="Spending this month"
            value={month?.spendingMinor ?? (thisMonth.isSuccess ? 0 : undefined)}
            currency={currency}
            tone="negative"
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <motion.div variants={fadeUp}>
            <Card className="h-full">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Cash flow</CardTitle>
                <span className="text-caption text-muted-foreground">Last 6 months</span>
              </CardHeader>
              <CashflowBars months={sixMonths.data?.months} />
            </Card>
          </motion.div>
          <motion.div variants={fadeUp}>
            <AccountsCard householdId={householdId} accounts={accounts.data} />
          </motion.div>
        </div>

        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle>Recent activity</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/app/${householdId}/transactions`}>
                  View all <ArrowRight />
                </Link>
              </Button>
            </CardHeader>
            <TransactionList
              transactions={recent.data?.data}
              categories={categories.data}
              accounts={accounts.data}
            />
          </Card>
        </motion.div>
      </motion.div>
    </Page>
  );
}

function StatCard({
  label,
  value,
  currency,
  tone,
  emphasis = false,
}: {
  label: string;
  value: number | undefined;
  currency: string;
  tone?: "positive" | "negative";
  emphasis?: boolean;
}) {
  return (
    <motion.div variants={fadeUp}>
      <Card
        className={cn("p-5", emphasis && "border-transparent bg-primary text-primary-foreground")}
      >
        <p className={cn("text-sm", emphasis ? "opacity-80" : "text-muted-foreground")}>{label}</p>
        {value === undefined ? (
          <Skeleton className={cn("mt-2 h-8 w-40", emphasis && "bg-white/20")} />
        ) : (
          <AnimatedMoney
            value={value}
            currency={currency}
            className={cn(
              "mt-1 block text-2xl font-semibold tracking-tight sm:text-3xl",
              tone === "positive" && "text-positive",
              tone === "negative" && "text-negative",
            )}
          />
        )}
      </Card>
    </motion.div>
  );
}

/** A lightweight preview chart (real charts arrive in Stage 8): bars grow with springs. */
function CashflowBars({
  months,
}: {
  months?: Array<{ month: string; incomeMinor: number; spendingMinor: number }>;
}) {
  if (!months) return <Skeleton className="m-5 h-48 rounded-xl" />;
  const max = Math.max(1, ...months.flatMap((m) => [m.incomeMinor, m.spendingMinor]));
  return (
    <div className="p-5">
      <div
        className="flex h-48 items-end gap-3"
        role="img"
        aria-label="Income and spending for the last six months"
      >
        {months.map((m, index) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-40 w-full items-end justify-center gap-1">
              {[
                { value: m.incomeMinor, className: "bg-positive/80" },
                { value: m.spendingMinor, className: "bg-negative/70" },
              ].map((bar, barIndex) => (
                <motion.div
                  key={barIndex}
                  className={cn("w-full max-w-5 rounded-t-md", bar.className)}
                  initial={{ height: 0 }}
                  animate={{ height: `${(bar.value / max) * 100}%` }}
                  transition={{ ...spring.smooth, delay: index * 0.04 }}
                />
              ))}
            </div>
            <span className="text-caption text-muted-foreground">{formatMonth(m.month)}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-4 text-caption text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-positive" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-negative" /> Spending
        </span>
      </div>
    </div>
  );
}

function AccountsCard({ householdId, accounts }: { householdId: string; accounts?: AccountDto[] }) {
  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle>Accounts</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/${householdId}/accounts`}>
            Manage <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <ul className="px-2 pb-2">
        {!accounts
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mx-3 my-3 h-9" />)
          : accounts.map((account) => {
              const Icon = accountIcons[account.type];
              return (
                <li key={account.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">{account.name}</span>
                  <AnimatedMoney
                    value={account.balanceMinor}
                    currency={account.currency}
                    className="text-sm font-medium"
                  />
                </li>
              );
            })}
      </ul>
    </Card>
  );
}

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
