"use client";

import type { CategoryDto, RecurringSeriesDto } from "@ledgerly/shared";
import { CalendarClock, Repeat, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useCreateRule } from "@/lib/query/automation";
import { motion } from "motion/react";
import { fullMoney } from "@/components/charts/format";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { localToday } from "@/lib/budgets";
import { CategoryIcon } from "@/lib/category-icons";
import { formatDay } from "@/lib/dates";
import { fadeUp, stagger } from "@/lib/motion";
import { useRecurring } from "@/lib/query/budgets";

const cadenceLabel: Record<RecurringSeriesDto["cadence"], string> = {
  weekly: "Weekly",
  twice_monthly: "Twice a month",
  monthly: "Monthly",
};

const DAY_MS = 86_400_000;
const daysUntil = (date: string, today: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

function when(date: string, today: string) {
  const days = daysUntil(date, today);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  return formatDay(date);
}

/**
 * Bills DETECTED from history (no setup needed): "we saw Rent 6 times, about
 * monthly". Shows the next 30 days, so the user knows what's already spoken for.
 */
export function UpcomingBills({
  householdId,
  categories,
  currency,
  canEdit,
}: {
  householdId: string;
  categories: CategoryDto[] | undefined;
  currency: string;
  canEdit: boolean;
}) {
  const { data, isPending } = useRecurring(householdId);
  const createRule = useCreateRule(householdId);

  /** Turn a DETECTED series into a RULE: from now on, the worker records it on its own. */
  function automate(bill: RecurringSeriesDto) {
    const day = Number(bill.nextDate.slice(8, 10));
    createRule.mutate(
      {
        accountId: bill.accountId,
        categoryId: bill.categoryId,
        description: bill.description,
        amountMinor: bill.amountMinor,
        cadence: bill.cadence,
        nextDate: bill.nextDate,
        secondDay:
          bill.cadence === "twice_monthly" ? bill.daysOfMonth.find((d) => d !== day) : undefined,
        seriesKey: bill.key,
      },
      {
        onSuccess: () =>
          toast.success(`${bill.description} is now automatic`, {
            description: `It will be recorded on ${formatDay(bill.nextDate)}${bill.variable ? " (at its typical amount)" : ""}.`,
          }),
      },
    );
  }
  const today = localToday();
  const bills =
    data?.series.filter((s) => s.amountMinor < 0 && daysUntil(s.nextDate, today) <= 30) ?? [];
  const total = bills.reduce((sum, s) => sum + -s.amountMinor, 0);
  const iconFor = (categoryId: string | null) => {
    const category = categories?.find((c) => c.id === categoryId);
    const parent = categories?.find((c) => c.id === category?.parentId);
    return category?.icon ?? parent?.icon ?? null;
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Upcoming bills</h2>
          <p className="text-sm text-muted-foreground">
            {isPending
              ? " "
              : bills.length
                ? `${fullMoney(total, currency)} due in the next 30 days`
                : "Nothing recurring due soon"}
          </p>
        </div>
        <CalendarClock className="size-5 text-muted-foreground" aria-hidden />
      </div>

      {isPending ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : (
        <motion.ul variants={stagger(0.04)} initial="hidden" animate="visible" className="-mx-2">
          {bills.map((bill) => (
            <motion.li
              key={bill.key}
              variants={fadeUp}
              className="flex items-center gap-3 rounded-xl px-2 py-2"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <CategoryIcon name={iconFor(bill.categoryId)} className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{bill.description}</span>
                <span className="flex items-center gap-1 text-caption text-muted-foreground">
                  <Repeat className="size-3" aria-hidden />
                  {cadenceLabel[bill.cadence]} · seen {bill.occurrences}×
                </span>
              </span>
              <span className="text-right">
                <span className="block text-sm font-medium tabular-nums">
                  {/* "≈" = the amount changes month to month (utilities): this is the typical one. */}
                  {bill.variable && (
                    <span className="text-muted-foreground" title="Amount varies">
                      ≈{" "}
                    </span>
                  )}
                  {fullMoney(-bill.amountMinor, currency)}
                </span>
                <span className="block text-caption text-muted-foreground">
                  {when(bill.nextDate, today)}
                </span>
              </span>
              {bill.ruleId ? (
                <Badge tone="primary" title="Recorded automatically">
                  <Zap aria-hidden /> Auto
                </Badge>
              ) : (
                canEdit && (
                  <button
                    type="button"
                    onClick={() => automate(bill)}
                    disabled={createRule.isPending}
                    aria-label={`Automate ${bill.description}`}
                    title="Record this automatically"
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary-subtle hover:text-primary"
                  >
                    <Zap className="size-4" />
                  </button>
                )
              )}
            </motion.li>
          ))}
        </motion.ul>
      )}
    </Card>
  );
}
