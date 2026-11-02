"use client";

import type { AccountDto, RecurringRuleDto } from "@ledgerly/shared";
import { Pause, Play, Trash2, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { fullMoney } from "@/components/charts/format";
import { Card } from "@/components/ui/card";
import { formatDay } from "@/lib/dates";
import { spring } from "@/lib/motion";
import { useDeleteRule, useRecurringRules, useToggleRule } from "@/lib/query/automation";
import { cn } from "@/lib/utils";

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

function schedule(rule: RecurringRuleDto) {
  if (rule.cadence === "weekly") return "Every week";
  return `Monthly on the ${rule.daysOfMonth.map(ordinal).join(" and ")}`;
}

/** Rules the background worker runs: what, when next, and controls to pause or delete. */
export function AutomationCard({
  householdId,
  accounts,
  canEdit,
}: {
  householdId: string;
  accounts: AccountDto[] | undefined;
  canEdit: boolean;
}) {
  const { data: rules } = useRecurringRules(householdId);
  const toggle = useToggleRule(householdId);
  const remove = useDeleteRule(householdId);
  const [armed, setArmed] = useState<string | null>(null);
  if (!rules?.length) return null;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Automatic transactions</h2>
          <p className="text-sm text-muted-foreground">Recorded for you when they&apos;re due.</p>
        </div>
        <Zap className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <ul className="-mx-2">
        <AnimatePresence initial={false}>
          {rules.map((rule) => {
            const currency = accounts?.find((a) => a.id === rule.accountId)?.currency ?? "USD";
            return (
              <motion.li
                key={rule.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring.smooth}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-2 py-2",
                  !rule.active && "opacity-60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{rule.description}</span>
                  <span className="block text-caption text-muted-foreground">
                    {schedule(rule)} · {rule.active ? `next ${formatDay(rule.nextDate)}` : "paused"}
                  </span>
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {fullMoney(Math.abs(rule.amountMinor), currency)}
                </span>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggle.mutate({ id: rule.id, active: !rule.active })}
                      aria-label={`${rule.active ? "Pause" : "Resume"} ${rule.description}`}
                      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {rule.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (armed !== rule.id) return setArmed(rule.id);
                        remove.mutate(rule.id);
                        setArmed(null);
                      }}
                      onBlur={() => setArmed(null)}
                      aria-label={
                        armed === rule.id
                          ? `Confirm: stop automating ${rule.description}`
                          : `Stop automating ${rule.description}`
                      }
                      title={
                        armed === rule.id
                          ? "Click again to delete"
                          : "Delete rule (past transactions stay)"
                      }
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg transition-colors",
                        armed === rule.id
                          ? "bg-negative text-white dark:text-black"
                          : "text-muted-foreground hover:bg-negative-subtle hover:text-negative",
                      )}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </Card>
  );
}
