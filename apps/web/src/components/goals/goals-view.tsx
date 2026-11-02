"use client";

import type { GoalDto } from "@ledgerly/shared";
import { CalendarCheck, Goal, Pencil, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useCurrentHousehold } from "@/components/app-shell/household-context";
import { Page } from "@/components/app-shell/page";
import { fullMoney, wholeMoney } from "@/components/charts/format";
import { AnimatedMoney } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMonthYear } from "@/lib/budgets";
import { fadeUp, spring, stagger } from "@/lib/motion";
import { useGoals } from "@/lib/query/budgets";
import { useAccounts } from "@/lib/query/hooks";
import { useNewParam } from "@/lib/use-new-param";
import { GoalDialog } from "./goal-dialog";
import { ProgressRing } from "./progress-ring";

type DialogState = { open: false } | { open: true; goal: GoalDto | null };

const statusBadge: Record<
  GoalDto["status"],
  { label: string; tone: "positive" | "warning" | "neutral" | "primary" }
> = {
  reached: { label: "Reached", tone: "positive" },
  on_track: { label: "On track", tone: "positive" },
  behind: { label: "Behind", tone: "warning" },
  no_progress: { label: "Not growing", tone: "warning" },
  no_deadline: { label: "No deadline", tone: "neutral" },
};

const monthsBetween = (from: string, to: string) => {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The forecast as ONE plain sentence — more useful than a number with no context. */
export function projectionText(goal: GoalDto) {
  const money = (minor: number) => fullMoney(minor, goal.currency);
  const pace = `${wholeMoney(goal.monthlyPaceMinor, goal.currency)}/mo`;
  const target = goal.targetDate ? formatMonthYear(goal.targetDate.slice(0, 7)) : null;
  // A forecast decades away isn't useful as a date — say so plainly instead.
  const tooFar =
    goal.projectedMonth !== null &&
    monthsBetween(new Date().toISOString().slice(0, 7), goal.projectedMonth) > 120;
  if (tooFar && (goal.status === "behind" || goal.status === "no_deadline")) {
    const required = goal.requiredMonthlyMinor
      ? ` Saving ${money(goal.requiredMonthlyMinor)}/mo would hit ${target}.`
      : "";
    return `At ${pace}, this would take more than 10 years.${required}`;
  }
  switch (goal.status) {
    case "reached":
      return "You've reached this goal. Nice work.";
    case "on_track":
      return goal.projectedMonth === goal.targetDate!.slice(0, 7)
        ? `At ${pace}, you'll get there by ${formatMonthYear(goal.projectedMonth)} — just in time.`
        : `At ${pace}, you'll get there by ${formatMonthYear(goal.projectedMonth!)}, ahead of ${target}.`;
    case "behind": {
      const late = monthsBetween(goal.targetDate!.slice(0, 7), goal.projectedMonth!);
      return `At ${pace}, you'll get there by ${formatMonthYear(goal.projectedMonth!)}, ${plural(late, "month")} late. Saving ${money(goal.requiredMonthlyMinor!)}/mo would hit ${target}.`;
    }
    case "no_progress":
      return goal.requiredMonthlyMinor
        ? `This account hasn't grown lately. Saving ${money(goal.requiredMonthlyMinor)}/mo would hit ${target}.`
        : "This account hasn't grown lately — add money regularly to see a forecast.";
    case "no_deadline":
      return `At ${pace}, you'll get there by ${formatMonthYear(goal.projectedMonth!)}.`;
  }
}

export function GoalsView({ householdId }: { householdId: string }) {
  const household = useCurrentHousehold();
  const canEdit = household?.role !== "viewer";
  const { data: goals, isPending } = useGoals(householdId);
  const accounts = useAccounts(householdId);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  useNewParam(() => canEdit && setDialog({ open: true, goal: null }));

  return (
    <Page
      title="Goals"
      description="Savings targets, tracked against the real balance of an account."
      actions={
        canEdit && (
          <Button onClick={() => setDialog({ open: true, goal: null })}>
            <Plus /> New goal
          </Button>
        )
      }
    >
      {isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : goals?.length === 0 ? (
        <Card className="grid place-items-center gap-3 px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
            <Goal className="size-6" />
          </span>
          <p className="font-medium">No goals yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Pick an account, a target and (optionally) a date. Ledgerly forecasts when you&apos;ll
            get there from how the account has grown.
          </p>
          {canEdit && (
            <Button onClick={() => setDialog({ open: true, goal: null })}>
              <Plus /> New goal
            </Button>
          )}
        </Card>
      ) : (
        <motion.ul
          variants={stagger(0.06)}
          initial="hidden"
          animate="visible"
          className="grid gap-4 md:grid-cols-2"
        >
          <AnimatePresence initial={false}>
            {goals?.map((goal) => (
              <motion.li
                key={goal.id}
                variants={fadeUp}
                layout
                exit={{ opacity: 0, scale: 0.96 }}
                transition={spring.smooth}
                className="min-w-0"
              >
                <GoalCard
                  goal={goal}
                  onEdit={canEdit ? () => setDialog({ open: true, goal }) : undefined}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      <GoalDialog
        open={dialog.open}
        onOpenChange={(open) => !open && setDialog({ open: false })}
        householdId={householdId}
        goal={dialog.open ? dialog.goal : null}
        accounts={accounts.data}
        goals={goals}
      />
    </Page>
  );
}

function GoalCard({ goal, onEdit }: { goal: GoalDto; onEdit?: () => void }) {
  const badge = statusBadge[goal.status];
  return (
    <Card className="flex h-full flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <ProgressRing value={goal.progress} label={`${goal.name} progress`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-semibold">{goal.name}</h2>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{goal.accountName}</p>
          <p className="mt-2 tabular-nums">
            <AnimatedMoney
              value={goal.balanceMinor}
              currency={goal.currency}
              className="text-xl font-semibold tracking-tight"
            />
            <span className="text-sm text-muted-foreground">
              {" "}
              of {fullMoney(goal.targetMinor, goal.currency)}
            </span>
          </p>
        </div>
        {onEdit && (
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${goal.name}`}>
            <Pencil />
          </Button>
        )}
      </div>

      <p className="text-sm text-pretty">{projectionText(goal)}</p>

      <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
        <div>
          <dt className="text-caption text-muted-foreground">To go</dt>
          <dd className="font-medium tabular-nums">
            {fullMoney(goal.remainingMinor, goal.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-muted-foreground">Recent pace</dt>
          <dd className="font-medium tabular-nums">
            {goal.monthlyPaceMinor >= 0 ? "+" : "−"}
            {wholeMoney(Math.abs(goal.monthlyPaceMinor), goal.currency)}/mo
          </dd>
        </div>
        <div>
          <dt className="text-caption text-muted-foreground">Target date</dt>
          <dd className="flex items-center gap-1 font-medium">
            {goal.targetDate ? (
              <>
                <CalendarCheck className="size-3.5 text-muted-foreground" aria-hidden />
                {formatMonthYear(goal.targetDate.slice(0, 7))}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
