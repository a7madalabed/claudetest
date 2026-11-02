"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

/**
 * One tooltip for ALL series at the hovered position. Values lead (strong, high
 * contrast), labels follow; series are keyed with a short line, not a box.
 * Rendered as React text, so category names from the database can never inject
 * HTML (never build tooltips with innerHTML).
 */
export function ChartTooltip({
  x,
  y,
  containerWidth,
  title,
  rows,
  footer,
}: {
  x: number;
  y: number;
  containerWidth: number;
  title: string;
  rows: TooltipRow[];
  footer?: ReactNode;
}) {
  const flip = x > containerWidth - 180; // keep it inside the card near the right edge
  return (
    <motion.div
      role="presentation"
      className="pointer-events-none absolute top-0 left-0 z-10 min-w-40 rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm shadow-elevation-3"
      initial={false}
      animate={{ x: flip ? x - 12 : x + 12, y, translateX: flip ? "-100%" : "0%" }}
      transition={{ type: "spring", stiffness: 700, damping: 45 }}
    >
      <p className="mb-1.5 text-caption text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            {row.color && (
              <span
                aria-hidden
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ background: row.color }}
              />
            )}
            <span className="font-semibold tabular-nums">{row.value}</span>
            <span className="text-muted-foreground">{row.label}</span>
          </li>
        ))}
      </ul>
      {footer && (
        <div className="mt-1.5 border-t border-border pt-1.5 text-caption text-muted-foreground">
          {footer}
        </div>
      )}
    </motion.div>
  );
}
