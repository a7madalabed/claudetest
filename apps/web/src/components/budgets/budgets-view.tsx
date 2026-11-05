"use client";

import type { BudgetDto } from "@ledgerly/shared";
import { ChevronLeft, ChevronRight, Plus, Repeat } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useCurrentHousehold } from "@/components/app-shell/household-context";
import { Page } from "@/components/app-shell/page";
import { fullMoney } from "@/components/charts/format";
import { AnimatedMoney } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, loadFailed } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMonthYear, isValidMonth, localMonth, monthElapsed, shiftMonth } from "@/lib/budgets";
import { CategoryIcon } from "@/lib/category-icons";
import { spring } from "@/lib/motion";
import { useHydrated } from "@/lib/use-hydrated";
import { useNewParam } from "@/lib/use-new-param";
import { useBudgets } from "@/lib/query/budgets";
import { useAccounts, useCategories } from "@/lib/query/hooks";
import { AutomationCard } from "./automation-card";
import { BudgetBar } from "./budget-bar";
import { BudgetDialog } from "./budget-dialog";
import { StatusLabel } from "./status";
import { UpcomingBills } from "./upcoming-bills";

type DialogState = { open: false } | { open: true; budget: BudgetDto | null };

export function BudgetsView({ householdId }: { householdId: string }) {
  const household = useCurrentHousehold();
  const currency = household?.baseCurrency ?? "USD";
  const canEdit = household?.role !== "viewer";

  // The month lives in the URL (?month=2026-05): shareable, and Back works.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const param = searchParams.get("month");
  const thisMonth = localMonth();
  const month = isValidMonth(param) ? param : thisMonth;
  const [direction, setDirection] = useState(0);
  const goTo = (next: string) => {
    setDirection(next > month ? 1 : -1);
    router.replace(next === thisMonth ? pathname : `${pathname}?month=${next}`, { scroll: false });
  };

  const query = useBudgets(householdId, month);
  const hydrated = useHydrated();
  const { isPlaceholderData } = query;
  const data = hydrated ? query.data : undefined;
  const isPending = !hydrated || query.isPending;
  const categories = useCategories(householdId);
  const accounts = useAccounts(householdId);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  useNewParam(() => setDialog({ open: true, budget: null }));
  const elapsed = monthElapsed(month);
  const totals = data?.totals;

  return (
    <Page
      title="Budgets"
      description="Monthly limits per category. Spending updates the moment you record it."
      actions={
        canEdit && (
          <Button onClick={() => setDialog({ open: true, budget: null })}>
            <Plus /> New budget
          </Button>
        )
      }
    >
      {/* ── Month switcher ─────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          onClick={() => goTo(shiftMonth(month, -1))}
        >
          <ChevronLeft />
        </Button>
        <div className="relative h-7 w-40 overflow-hidden text-center" aria-live="polite">
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.h2
              key={month}
              custom={direction}
              variants={{
                enter: (d: number) => ({ x: d * 24, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (d: number) => ({ x: d * -24, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={spring.snappy}
              className="text-lg font-semibold"
            >
              {formatMonthYear(month)}
            </motion.h2>
          </AnimatePresence>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next month"
          onClick={() => goTo(shiftMonth(month, 1))}
        >
          <ChevronRight />
        </Button>
        {month !== thisMonth && (
          <Button variant="outline" size="sm" onClick={() => goTo(thisMonth)}>
            This month
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {/* ── Summary ───────────────────────────────────────────────── */}
          <Card className="p-5 sm:p-6">
            {loadFailed(query) ? (
              <ErrorState compact onRetry={query.refetch} />
            ) : isPending || !totals ? (
              <Skeleton className="h-28" />
            ) : (
              <div
                className="space-y-4 transition-opacity"
                style={{ opacity: isPlaceholderData ? 0.6 : 1 }}
              >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {totals.remainingMinor >= 0 ? "Left to spend" : "Over budget by"}
                    </p>
                    <AnimatedMoney
                      value={Math.abs(totals.remainingMinor)}
                      currency={currency}
                      className={`text-display font-semibold tracking-tight ${totals.remainingMinor < 0 ? "text-negative" : ""}`}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {fullMoney(totals.spentMinor, currency)} spent of{" "}
                    {fullMoney(totals.availableMinor, currency)}
                  </p>
                </div>
                <BudgetBar
                  size="lg"
                  spentMinor={totals.spentMinor}
                  availableMinor={totals.availableMinor}
                  status={
                    totals.spentMinor > totals.availableMinor
                      ? "over"
                      : totals.spentMinor >= totals.availableMinor * 0.8
                        ? "warning"
                        : "ok"
                  }
                  elapsed={elapsed}
                  label="All budgets"
                />
                <p className="text-caption text-muted-foreground">
                  {elapsed > 0 && elapsed < 1 && (
                    <>
                      <span className="mr-1 inline-block h-2.5 w-0.5 rounded-full bg-foreground/70 align-middle" />{" "}
                      {Math.round(elapsed * 100)}% of the month gone ·{" "}
                    </>
                  )}
                  {fullMoney(data.unbudgetedSpendingMinor, currency)} spent outside budgets
                </p>
              </div>
            )}
          </Card>

          {/* ── Budget rows ───────────────────────────────────────────── */}
          {/* Failed: the summary card above already says so. */}
          {!loadFailed(query) && (
            <Card className="overflow-hidden p-0">
              {isPending ? (
                <div className="space-y-4 p-5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-14" />
                  ))}
                </div>
              ) : data?.budgets.length === 0 ? (
                <div className="grid place-items-center gap-3 px-6 py-16 text-center">
                  <p className="font-medium">No budgets for {formatMonthYear(month)}</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Budgets start in the month you create them. Add one to set a monthly limit for a
                    category like Groceries or Dining out.
                  </p>
                  {canEdit && (
                    <Button onClick={() => setDialog({ open: true, budget: null })}>
                      <Plus /> New budget
                    </Button>
                  )}
                </div>
              ) : (
                <ul
                  className="divide-y divide-border transition-opacity"
                  style={{ opacity: isPlaceholderData ? 0.6 : 1 }}
                >
                  <AnimatePresence initial={false}>
                    {data?.budgets.map((budget) => (
                      <motion.li
                        key={budget.id}
                        // `layout`: when a budget's status changes and the list re-sorts,
                        // rows GLIDE to their new place instead of jumping.
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={spring.smooth}
                      >
                        <BudgetRow
                          budget={budget}
                          currency={currency}
                          elapsed={elapsed}
                          onEdit={canEdit ? () => setDialog({ open: true, budget }) : undefined}
                        />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-6">
          <UpcomingBills
            householdId={householdId}
            categories={categories.data}
            currency={currency}
            canEdit={canEdit}
          />
          <AutomationCard householdId={householdId} accounts={accounts.data} canEdit={canEdit} />
        </aside>
      </div>

      <BudgetDialog
        open={dialog.open}
        onOpenChange={(open) => !open && setDialog({ open: false })}
        householdId={householdId}
        budget={dialog.open ? dialog.budget : null}
        month={month}
        currency={currency}
        categories={categories.data}
        budgetedCategoryIds={data?.budgets.map((b) => b.categoryId) ?? []}
      />
    </Page>
  );
}

function BudgetRow({
  budget,
  currency,
  elapsed,
  onEdit,
}: {
  budget: BudgetDto;
  currency: string;
  elapsed: number;
  onEdit?: () => void;
}) {
  const over = budget.remainingMinor < 0;
  const content = (
    <>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <CategoryIcon name={budget.icon} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate font-medium">{budget.name}</span>
            {budget.rollover && (
              <Badge title="Unspent money carries over to next month">
                <Repeat aria-hidden />
                {budget.rolloverMinor === 0
                  ? "Rollover"
                  : `${budget.rolloverMinor > 0 ? "+" : "−"}${fullMoney(Math.abs(budget.rolloverMinor), currency)} carried`}
              </Badge>
            )}
          </div>
          <StatusLabel status={budget.status} />
        </div>
        <div className="text-right">
          <p className={`font-medium tabular-nums ${over ? "text-negative" : ""}`}>
            {fullMoney(Math.abs(budget.remainingMinor), currency)} {over ? "over" : "left"}
          </p>
          <p className="text-caption text-muted-foreground tabular-nums">
            {fullMoney(budget.spentMinor, currency)} of {fullMoney(budget.availableMinor, currency)}
          </p>
        </div>
      </div>
      <div className="mt-3 pl-12">
        <BudgetBar
          spentMinor={budget.spentMinor}
          availableMinor={budget.availableMinor}
          status={budget.status}
          elapsed={elapsed}
          label={`${budget.name} budget`}
        />
      </div>
    </>
  );
  return onEdit ? (
    <button
      type="button"
      onClick={onEdit}
      className="block w-full px-5 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
    >
      {/* No aria-label: it would REPLACE the visible amounts and status for screen
          reader users. The name is "Edit" + everything on the row (Stage 13). */}
      <span className="sr-only">Edit </span>
      {content}
    </button>
  ) : (
    <div className="px-5 py-4">{content}</div>
  );
}
