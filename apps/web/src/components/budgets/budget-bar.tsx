"use client";

import type { BudgetStatus } from "@ledgerly/shared";
import { motion, useReducedMotion } from "motion/react";
import { STATUS_COLOR } from "@/lib/budgets";
import { cn } from "@/lib/utils";

/**
 * A budget's progress: how much of what's available has been spent.
 *
 *  - The FILL is coloured by STATUS (ok / warning / over) — state, not identity,
 *    so it uses the reserved status colours, and the row always repeats the
 *    status as an icon + words next to it (never colour alone).
 *  - The thin vertical TICK marks how far through the month we are. Spending
 *    ahead of the tick means you're spending faster than the month is passing.
 */
export function BudgetBar({
  spentMinor,
  availableMinor,
  status,
  elapsed,
  label,
  size = "md",
}: {
  spentMinor: number;
  availableMinor: number;
  status: BudgetStatus;
  /** 0–1 share of the month gone; null hides the tick. */
  elapsed: number | null;
  label: string;
  size?: "sm" | "md" | "lg";
}) {
  const reduceMotion = useReducedMotion();
  const used = availableMinor > 0 ? spentMinor / availableMinor : spentMinor > 0 ? 1 : 0;
  const width = Math.max(0, Math.min(1, used));
  const showTick = elapsed !== null && elapsed > 0 && elapsed < 1;

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.max(0, used) * 100)}
      aria-valuetext={`${Math.round(Math.max(0, used) * 100)}% spent${showTick ? `, ${Math.round(elapsed * 100)}% of the month gone` : ""}`}
      className={cn(
        "relative rounded-full bg-muted",
        size === "sm" && "h-1.5",
        size === "md" && "h-2",
        size === "lg" && "h-3",
      )}
    >
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        initial={reduceMotion ? false : { width: 0 }}
        animate={{ width: `${width * 100}%`, backgroundColor: STATUS_COLOR[status] }}
        transition={{
          width: { type: "spring", stiffness: 140, damping: 24 },
          backgroundColor: { duration: 0.3 },
        }}
      />
      {showTick && (
        <span
          aria-hidden
          // A 2px ring in the surface colour keeps the tick legible on top of the fill.
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70 ring-2 ring-surface"
          style={{ left: `${elapsed * 100}%` }}
        />
      )}
    </div>
  );
}
