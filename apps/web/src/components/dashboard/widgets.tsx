"use client";

import { ArrowRight, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BarList, type BarListItem } from "@/components/charts/bar-list";
import { ChartCard } from "@/components/charts/chart-card";
import { COLUMN_CHART_HEIGHT, ColumnChart } from "@/components/charts/column-chart";
import {
  fullMoney,
  longMonth,
  shortMoney,
  shortMonth,
  wholeMoney,
} from "@/components/charts/format";
import { Legend } from "@/components/charts/legend";
import { LINE_CHART_HEIGHT, LineChart } from "@/components/charts/line-chart";
import { AnimatedMoney } from "@/components/money";
import { accountIcons, TransactionList } from "@/components/overview/overview";
import { BudgetBar } from "@/components/budgets/budget-bar";
import { StatusLabel } from "@/components/budgets/status";
import { ErrorState, loadFailed } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABEL, localMonth, monthElapsed } from "@/lib/budgets";
import { CategoryIcon } from "@/lib/category-icons";
import { spendingPace } from "@/lib/dashboard";
import { useBudgets } from "@/lib/query/budgets";
import { useHydrated } from "@/lib/use-hydrated";
import { useAccounts, useCashflow, useCategories, useRecentTransactions } from "@/lib/query/hooks";
import { useNetWorth, useSpendingByCategory } from "@/lib/query/reports";

type Range = { from: string; to: string };
const SERIES = {
  income: { key: "incomeMinor", label: "Income", color: "var(--chart-1)" },
  spending: { key: "spendingMinor", label: "Spending", color: "var(--chart-2)" },
};

function ChartSkeleton({ height }: { height: number }) {
  return <Skeleton className="w-full rounded-xl" style={{ height }} />;
}

// ─── Cash flow: income vs spending per month (grouped columns) ───────────────

export function CashflowWidget({
  householdId,
  range,
  currency,
  handle,
}: {
  householdId: string;
  range: Range;
  currency: string;
  handle: ReactNode;
}) {
  const query = useCashflow(householdId, range);
  const { data, isPending, isPlaceholderData } = query;
  const months = data?.months;
  const net = months?.reduce((sum, m) => sum + m.netMinor, 0) ?? 0;
  return (
    <ChartCard
      title="Cash flow"
      subtitle={
        months
          ? `${net >= 0 ? "Saved" : "Overspent by"} ${fullMoney(Math.abs(net), currency)} over ${months.length} months`
          : " "
      }
      dragHandle={handle}
      pending={isPlaceholderData}
      // Two series → a legend is always present; marks are rects, so swatches are too.
      legend={<Legend items={[SERIES.income, SERIES.spending]} />}
      table={
        months && {
          columns: ["Month", "Income", "Spending", "Net"],
          numeric: [1, 2, 3],
          rows: months.map((m) => [
            longMonth(m.month),
            fullMoney(m.incomeMinor, currency),
            fullMoney(m.spendingMinor, currency),
            fullMoney(m.netMinor, currency),
          ]),
        }
      }
    >
      {loadFailed(query) ? (
        <ErrorState compact onRetry={query.refetch} />
      ) : isPending || !months ? (
        <ChartSkeleton height={COLUMN_CHART_HEIGHT} />
      ) : (
        <ColumnChart
          data={months}
          series={[SERIES.income, SERIES.spending]}
          currency={currency}
          footer={(m) =>
            `Net ${m.netMinor >= 0 ? "+" : "−"}${fullMoney(Math.abs(m.netMinor), currency)}`
          }
        />
      )}
    </ChartCard>
  );
}

// ─── Spending by category: ranked bars with drill-down ───────────────────────

export function CategoryWidget({
  householdId,
  range,
  currency,
  handle,
}: {
  householdId: string;
  range: Range;
  currency: string;
  handle: ReactNode;
}) {
  const [parent, setParent] = useState<{ id: string; name: string } | null>(null);
  const report = useSpendingByCategory(householdId, range, parent?.id);
  const categories = useCategories(householdId);
  const hasChildren = (id: string) => categories.data?.some((c) => c.parentId === id) ?? false;

  const items: BarListItem[] =
    report.data?.categories.map((c) => ({
      id: c.categoryId,
      label: parent && c.categoryId === parent.id ? `${c.name} (general)` : c.name,
      // Subcategories usually have no icon of their own: inherit the parent's.
      icon: c.icon ?? categories.data?.find((p) => p.id === parent?.id)?.icon ?? null,
      valueMinor: c.spendingMinor,
      share: c.share,
      drillable: !parent && hasChildren(c.categoryId),
    })) ?? [];

  return (
    <ChartCard
      title={
        parent ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setParent(null)}
              className="-ml-1 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Back to all categories"
            >
              <ChevronLeft className="size-4" />
            </button>
            {parent.name}
          </span>
        ) : (
          "Spending by category"
        )
      }
      subtitle={
        report.data
          ? `${fullMoney(report.data.totalMinor, currency)} total${parent ? "" : " · select a category to break it down"}`
          : " "
      }
      dragHandle={handle}
      pending={report.isPlaceholderData}
      actions={
        parent && (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/app/${householdId}/transactions?category=${parent.id}`}>
              Transactions <ArrowRight />
            </Link>
          </Button>
        )
      }
      table={
        report.data && {
          columns: ["Category", "Spent", "Share"],
          numeric: [1, 2],
          rows: items.map((i) => [
            i.label,
            fullMoney(i.valueMinor, currency),
            `${Math.round(i.share * 100)}%`,
          ]),
        }
      }
    >
      {loadFailed(report) ? (
        <ErrorState compact onRetry={report.refetch} />
      ) : report.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No spending in this period.
        </p>
      ) : (
        <BarList
          items={items}
          currency={currency}
          onSelect={(item) => {
            if (item.drillable) setParent({ id: item.id, name: item.label });
          }}
        />
      )}
    </ChartCard>
  );
}

// ─── Net worth trend: single-series area ─────────────────────────────────────

export function NetWorthWidget({
  householdId,
  range,
  currency,
  handle,
}: {
  householdId: string;
  range: Range;
  currency: string;
  handle: ReactNode;
}) {
  const query = useNetWorth(householdId, range);
  const { data, isPending, isPlaceholderData } = query;
  const points = data?.points;
  const change =
    points && points.length > 1 ? points.at(-1)!.balanceMinor - points[0]!.balanceMinor : 0;
  return (
    <ChartCard
      // One series: no legend box — the title already names what's plotted.
      title="Net worth"
      subtitle={
        points
          ? `${change >= 0 ? "Up" : "Down"} ${fullMoney(Math.abs(change), currency)} since ${longMonth(points[0]!.month)}`
          : " "
      }
      dragHandle={handle}
      pending={isPlaceholderData}
      table={
        points && {
          columns: ["Month end", "Net worth"],
          numeric: [1],
          rows: points.map((p) => [longMonth(p.month), fullMoney(p.balanceMinor, currency)]),
        }
      }
    >
      {loadFailed(query) ? (
        <ErrorState compact onRetry={query.refetch} />
      ) : isPending || !points ? (
        <ChartSkeleton height={LINE_CHART_HEIGHT} />
      ) : (
        <LineChart
          data={points}
          xKey="month"
          xLabel={(p, i) =>
            points.length <= 6 || i % 2 === points.length % 2 ? shortMonth(p.month) : null
          }
          xTitle={(p) => `End of ${longMonth(p.month)}`}
          // A LINE, not an area: the axis doesn't start at zero (a zero baseline would
          // flatten the trend), and a shaded area implies volume down to the axis.
          series={[
            { key: "balanceMinor", label: "Net worth", color: "var(--chart-1)", emphasis: true },
          ]}
          currency={currency}
          endLabel={(v) => shortMoney(v, currency)}
        />
      )}
    </ChartCard>
  );
}

// ─── Spending pace: emphasis (this month) vs context (last month) ───────────

export function SpendingPaceCard({
  days,
  currency,
  pending,
}: {
  days?: Array<{ date: string; incomeMinor: number; spendingMinor: number }>;
  currency: string;
  pending: boolean;
}) {
  const pace = days ? spendingPace(days) : undefined;
  const today = pace?.filter((p) => p.thisMonth !== null).at(-1);
  const diff = today && today.lastMonth !== null ? today.thisMonth! - today.lastMonth : null;
  const series = [
    // Emphasis form: the story is THIS month (accent); last month is grey context.
    { key: "lastMonth", label: "Last month", color: "var(--chart-muted)" },
    { key: "thisMonth", label: "This month", color: "var(--chart-1)", emphasis: true },
  ];
  return (
    <ChartCard
      title="Spending pace"
      subtitle={
        today && diff !== null
          ? `${fullMoney(today.thisMonth!, currency)} so far — ${fullMoney(Math.abs(diff), currency)} ${diff <= 0 ? "less" : "more"} than this time last month`
          : " "
      }
      legend={<Legend items={series.map((s) => ({ ...s, mark: "line" as const }))} />}
      table={
        pace && {
          columns: ["Day", "This month", "Last month"],
          numeric: [1, 2],
          rows: pace.map((p) => [
            p.day,
            p.thisMonth === null ? "—" : fullMoney(p.thisMonth, currency),
            p.lastMonth === null ? "—" : fullMoney(p.lastMonth, currency),
          ]),
        }
      }
    >
      {pending || !pace ? (
        <ChartSkeleton height={LINE_CHART_HEIGHT} />
      ) : (
        <LineChart
          data={pace}
          xKey="day"
          xLabel={(p) => ([1, 8, 15, 22, 29].includes(p.day) ? String(p.day) : null)}
          xTitle={(p) => `Day ${p.day}`}
          series={series}
          currency={currency}
          includeZero
          endLabel={(v) => shortMoney(v, currency)}
        />
      )}
    </ChartCard>
  );
}

// ─── Lists ───────────────────────────────────────────────────────────────────

export function AccountsWidget({
  householdId,
  handle,
}: {
  householdId: string;
  handle: ReactNode;
}) {
  const query = useAccounts(householdId);
  const { data: accounts } = query;
  return (
    <ChartCard
      title="Accounts"
      dragHandle={handle}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/${householdId}/accounts`}>
            Manage <ArrowRight />
          </Link>
        </Button>
      }
    >
      {loadFailed(query) && <ErrorState compact onRetry={query.refetch} />}
      <ul className="-mx-2">
        {loadFailed(query)
          ? null
          : !accounts
            ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mx-2 my-3 h-9" />)
            : accounts.map((account) => {
                const Icon = accountIcons[account.type];
                return (
                  <li key={account.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
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
    </ChartCard>
  );
}

export function RecentActivityWidget({
  householdId,
  handle,
}: {
  householdId: string;
  handle: ReactNode;
}) {
  const recent = useRecentTransactions(householdId, 8);
  const categories = useCategories(householdId);
  const accounts = useAccounts(householdId);
  return (
    <ChartCard
      title="Recent activity"
      dragHandle={handle}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/${householdId}/transactions`}>
            View all <ArrowRight />
          </Link>
        </Button>
      }
    >
      {loadFailed(recent) ? (
        <ErrorState compact onRetry={recent.refetch} />
      ) : (
        <div className="-mx-5 -mb-2">
          <TransactionList
            transactions={recent.data?.data}
            categories={categories.data}
            accounts={accounts.data}
          />
        </div>
      )}
    </ChartCard>
  );
}

// ─── Budgets: the most urgent few, this month ────────────────────────────────

export function BudgetsWidget({
  householdId,
  currency,
  handle,
}: {
  householdId: string;
  currency: string;
  handle: ReactNode;
}) {
  const month = localMonth();
  const query = useBudgets(householdId, month);
  const hydrated = useHydrated(); // the app shell may already have this query (see useHydrated)
  const data = hydrated ? query.data : undefined;
  const isPending = !hydrated || query.isPending;
  const elapsed = monthElapsed(month);
  // The API sorts most-urgent first, so the top five are the ones worth a glance.
  const top = data?.budgets.slice(0, 5) ?? [];
  const over = data?.budgets.filter((b) => b.status === "over").length ?? 0;
  return (
    <ChartCard
      title="Budgets"
      subtitle={
        data
          ? `${fullMoney(Math.max(0, data.totals.remainingMinor), currency)} left this month${over ? ` · ${over} over` : ""}`
          : " "
      }
      dragHandle={handle}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/${householdId}/budgets`}>
            All budgets <ArrowRight />
          </Link>
        </Button>
      }
      table={
        data && {
          columns: ["Budget", "Spent", "Available", "Status"],
          numeric: [1, 2],
          rows: data.budgets.map((b) => [
            b.name,
            fullMoney(b.spentMinor, currency),
            fullMoney(b.availableMinor, currency),
            STATUS_LABEL[b.status],
          ]),
        }
      }
    >
      {loadFailed(query) ? (
        <ErrorState compact onRetry={query.refetch} />
      ) : isPending ? (
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No budgets yet.{" "}
          <Link href={`/app/${householdId}/budgets?new=1`} className="text-primary hover:underline">
            Create one
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {top.map((b) => (
            <li key={b.id} className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CategoryIcon name={b.icon} className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                <StatusLabel status={b.status} className="hidden sm:inline-flex" />
                <span className="tabular-nums text-muted-foreground">
                  {wholeMoney(b.spentMinor, currency)} / {wholeMoney(b.availableMinor, currency)}
                </span>
              </div>
              <BudgetBar
                size="sm"
                spentMinor={b.spentMinor}
                availableMinor={b.availableMinor}
                status={b.status}
                elapsed={elapsed}
                label={`${b.name} budget`}
              />
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
