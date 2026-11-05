"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DashboardWidget } from "@ledgerly/shared";
import { motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { useCurrentHousehold } from "@/components/app-shell/household-context";
import { NoAccountsNotice } from "@/components/overview/no-accounts";
import { ErrorState, loadFailed } from "@/components/ui/error-state";
import { Page } from "@/components/app-shell/page";
import { DragHandle } from "@/components/charts/chart-card";
import { shortMoney } from "@/components/charts/format";
import { Meter } from "@/components/charts/meter";
import { Sparkline } from "@/components/charts/sparkline";
import { StatTile } from "@/components/charts/stat-tile";
import {
  TREND_RANGES,
  monthToDate,
  monthWindows,
  relativeChange,
  savingsRate,
  trendRange,
  type TrendRange,
} from "@/lib/dashboard";
import { spring } from "@/lib/motion";
import { useAccounts, useMe } from "@/lib/query/hooks";
import {
  useDailyCashflow,
  useDashboardLayout,
  useNetWorth,
  useSaveDashboardLayout,
} from "@/lib/query/reports";
import { cn } from "@/lib/utils";
import {
  AccountsWidget,
  BudgetsWidget,
  CashflowWidget,
  CategoryWidget,
  NetWorthWidget,
  RecentActivityWidget,
  SpendingPaceCard,
} from "./widgets";

const WIDGET_NAMES: Record<DashboardWidget, string> = {
  cashflow: "Cash flow",
  "spending-by-category": "Spending by category",
  "net-worth": "Net worth",
  accounts: "Accounts",
  "recent-activity": "Recent activity",
  budgets: "Budgets",
};
/** Wide widgets span both columns on large screens. */
const WIDE: DashboardWidget[] = ["cashflow"];

export function Dashboard({ householdId }: { householdId: string }) {
  const { data: me } = useMe();
  const household = useCurrentHousehold();
  const currency = household?.baseCurrency ?? "USD";
  const windows = useMemo(() => monthWindows(), []);

  // ── This month (fixed period) ──────────────────────────────────────────────
  const accounts = useAccounts(householdId);
  const daily = useDailyCashflow(householdId, windows.both);
  const yearOfNetWorth = useNetWorth(householdId, trendRange("12m"));
  const netWorth = accounts.data
    ?.filter((a) => a.currency === currency)
    .reduce((sum, a) => sum + a.balanceMinor, 0);
  const mtd = daily.data ? monthToDate(daily.data.days) : undefined;
  const points = yearOfNetWorth.data?.points;
  const lastMonthEnd =
    points && points.length >= 2 ? points[points.length - 2]!.balanceMinor : undefined;
  const rate = mtd ? savingsRate(mtd.current.income, mtd.current.spending) : undefined;

  // ── Trends (scoped by ONE range filter, kept in the URL) ───────────────────
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rangeParam = searchParams.get("range");
  const range: TrendRange =
    rangeParam && rangeParam in TREND_RANGES ? (rangeParam as TrendRange) : "6m";
  const trend = useMemo(() => trendRange(range), [range]);

  const layout = useDashboardLayout(householdId);
  const saveLayout = useSaveDashboardLayout(householdId);
  const widgets = layout.data?.widgets ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // a click on a chart isn't a drag
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const next = arrayMove(
      widgets,
      widgets.indexOf(active.id as DashboardWidget),
      widgets.indexOf(over.id as DashboardWidget),
    );
    saveLayout.mutate(next);
  }

  // Screen-reader announcements for drag-and-drop (Space to pick up, arrows to move, Space to drop).
  const name = (id: unknown) => WIDGET_NAMES[id as DashboardWidget] ?? "widget";
  const position = (id: unknown) => widgets.indexOf(id as DashboardWidget) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${name(active.id)}. Use the arrow keys to move, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${name(active.id)} is over position ${position(over.id)} of ${widgets.length}.`
        : `${name(active.id)} is no longer over a drop area.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${name(active.id)} dropped at position ${position(over.id)} of ${widgets.length}.`
        : `${name(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled.`,
  };

  const firstName = me?.displayName.split(" ")[0];
  const isNew = accounts.data?.length === 0;

  return (
    <Page
      title={`${isNew ? "Welcome" : "Welcome back"}${firstName ? `, ${firstName}` : ""}`}
      description={household?.name}
    >
      {/* A brand-new household: say where to start, before a page of zeros (Stage 16). */}
      {isNew && (
        <NoAccountsNotice
          householdId={householdId}
          canEdit={household?.role !== "viewer"}
          title="Start by adding an account"
          className="mb-8"
        >
          Add the accounts your money lives in — checking, savings, cards. Then record a transaction
          or import a bank statement, and this dashboard fills itself in.
        </NoAccountsNotice>
      )}
      {/* The headline figures come from three requests; if any failed, say so once. */}
      {(loadFailed(accounts) || loadFailed(daily) || loadFailed(yearOfNetWorth)) && (
        <ErrorState
          className="mb-8"
          description="Some of this month's figures couldn't be loaded. Check your connection, then try again."
          onRetry={() =>
            Promise.all([accounts.refetch(), daily.refetch(), yearOfNetWorth.refetch()])
          }
        />
      )}
      <section aria-labelledby="this-month" className="space-y-4">
        <h2 id="this-month" className="text-sm font-medium text-muted-foreground">
          This month so far
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.7fr_1fr_1fr_1fr]">
          {/* Exactly ONE hero figure per view: the number the dashboard leads with. */}
          <StatTile
            hero
            label="Net worth"
            valueMinor={netWorth}
            currency={currency}
            className="md:col-span-2 xl:col-span-1"
            delta={
              netWorth !== undefined && lastMonthEnd !== undefined
                ? {
                    change: relativeChange(netWorth, lastMonthEnd) ?? NaN,
                    period: "end of last month",
                    upIsGood: true,
                  }
                : undefined
            }
            trend={points && <Sparkline values={points.map((p) => p.balanceMinor)} />}
          />
          <StatTile
            label="Income"
            valueMinor={mtd?.current.income}
            currency={currency}
            delta={
              mtd
                ? relativeChange(mtd.current.income, mtd.previous.income) === null
                  ? null
                  : {
                      change: relativeChange(mtd.current.income, mtd.previous.income)!,
                      period: "same days last month",
                      upIsGood: true,
                    }
                : undefined
            }
          />
          <StatTile
            label="Spending"
            valueMinor={mtd?.current.spending}
            currency={currency}
            delta={
              mtd
                ? relativeChange(mtd.current.spending, mtd.previous.spending) === null
                  ? null
                  : {
                      change: relativeChange(mtd.current.spending, mtd.previous.spending)!,
                      period: "same days last month",
                      upIsGood: false,
                    }
                : undefined
            }
          />
          <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-elevation-1">
            <p className="text-sm text-muted-foreground">Savings rate</p>
            <p className="text-2xl font-semibold tracking-tight">
              {rate === undefined ? "…" : rate === null ? "—" : `${Math.round(rate * 100)}%`}
            </p>
            <Meter value={rate ?? 0} target={0.2} label="Savings rate this month" />
            <p className="text-caption text-muted-foreground">
              {mtd && rate !== null && rate !== undefined
                ? `Kept ${shortMoney(mtd.current.income - mtd.current.spending, currency)} of ${shortMoney(mtd.current.income, currency)} earned`
                : "Appears once income arrives"}
            </p>
          </div>
        </div>
        <SpendingPaceCard days={daily.data?.days} currency={currency} pending={daily.isPending} />
      </section>

      <section aria-labelledby="trends" className="mt-12 space-y-4">
        {/* One filter row, ABOVE everything it scopes. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="trends" className="text-sm font-medium text-muted-foreground">
            Trends
          </h2>
          <div role="radiogroup" aria-label="Trend period" className="flex rounded-lg bg-muted p-1">
            {(Object.keys(TREND_RANGES) as TrendRange[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={range === value}
                onClick={() =>
                  router.replace(value === "6m" ? pathname : `${pathname}?range=${value}`, {
                    scroll: false,
                  })
                }
                className={cn(
                  "relative rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  range === value
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {range === value && (
                  <motion.span
                    layoutId="trend-range-pill"
                    transition={spring.snappy}
                    className="absolute inset-0 rounded-md bg-surface shadow-elevation-1"
                  />
                )}
                <span className="relative">{TREND_RANGES[value]}</span>
              </button>
            ))}
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{ announcements }}
        >
          <SortableContext items={widgets} strategy={rectSortingStrategy}>
            <div className="grid gap-4 lg:grid-cols-2">
              {widgets.map((id) => (
                <SortableWidget key={id} id={id} wide={WIDE.includes(id)}>
                  {(handle) => {
                    switch (id) {
                      case "cashflow":
                        return (
                          <CashflowWidget
                            householdId={householdId}
                            range={trend}
                            currency={currency}
                            handle={handle}
                          />
                        );
                      case "spending-by-category":
                        return (
                          <CategoryWidget
                            householdId={householdId}
                            range={trend}
                            currency={currency}
                            handle={handle}
                          />
                        );
                      case "net-worth":
                        return (
                          <NetWorthWidget
                            householdId={householdId}
                            range={trend}
                            currency={currency}
                            handle={handle}
                          />
                        );
                      case "accounts":
                        return <AccountsWidget householdId={householdId} handle={handle} />;
                      case "recent-activity":
                        return <RecentActivityWidget householdId={householdId} handle={handle} />;
                      case "budgets":
                        return (
                          <BudgetsWidget
                            householdId={householdId}
                            currency={currency}
                            handle={handle}
                          />
                        );
                    }
                  }}
                </SortableWidget>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>
    </Page>
  );
}

function SortableWidget({
  id,
  wide,
  children,
}: {
  id: DashboardWidget;
  wide: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      data-widget={id}
      // Translate only (no scale): widgets of different sizes don't get squashed while dragging.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "min-w-0",
        wide && "lg:col-span-2",
        isDragging && "relative z-20 rounded-2xl opacity-90 shadow-elevation-3",
      )}
    >
      {children(
        <DragHandle {...attributes} {...listeners} aria-label={`Reorder ${WIDGET_NAMES[id]}`} />,
      )}
    </div>
  );
}
