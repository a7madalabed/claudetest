"use client";

import { BarChart3, GripVertical, Table2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TableView {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  /** Right-align numeric columns (by index). */
  numeric?: number[];
}

/**
 * Every chart lives in a <figure> with a title, an optional legend, and a
 * TABLE VIEW toggle: the same numbers as an accessible table. Charts are great
 * for patterns, tables for exact values and for screen readers — so we always
 * ship both (the WCAG-clean twin of every chart).
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  actions,
  dragHandle,
  pending = false,
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  legend?: ReactNode;
  table?: TableView;
  actions?: ReactNode;
  dragHandle?: ReactNode;
  /** Refetching: hold the previous render, dimmed (no skeleton flash, no layout jump). */
  pending?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <figure
      className={cn(
        "flex h-full flex-col rounded-2xl border border-border bg-surface shadow-elevation-1",
        className,
      )}
    >
      <div className="flex items-start gap-2 px-5 pt-4">
        {dragHandle}
        <figcaption className="min-w-0 flex-1">
          <div className="text-title">{title}</div>
          {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
        </figcaption>
        <div className="flex items-center gap-1">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setView(view === "chart" ? "table" : "chart")}
              aria-pressed={view === "table"}
              aria-label={view === "chart" ? "Show as table" : "Show as chart"}
              title={view === "chart" ? "Show as table" : "Show as chart"}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {view === "chart" ? <Table2 className="size-4" /> : <BarChart3 className="size-4" />}
            </button>
          )}
        </div>
      </div>
      {legend && view === "chart" && <div className="px-5 pt-3">{legend}</div>}
      <div
        className={cn(
          "relative flex-1 px-5 pt-3 pb-5 transition-opacity duration-200",
          pending && "opacity-60",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {view === "chart" || !table ? children : <DataTable table={table} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </figure>
  );
}

function DataTable({ table }: { table: TableView }) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface text-left text-caption text-muted-foreground">
          <tr>
            {table.columns.map((column, i) => (
              <th
                key={column}
                scope="col"
                className={cn("py-2 font-medium", table.numeric?.includes(i) && "text-right")}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular-nums">
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} className={cn("py-2", table.numeric?.includes(i) && "text-right")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Drag handle for rearranging dashboard widgets (wired to dnd-kit by the caller). */
export function DragHandle(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label="Reorder widget"
      className="-ml-2 mt-0.5 cursor-grab touch-none rounded-md p-1 text-muted-foreground opacity-50 transition-opacity hover:bg-muted hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
      {...props}
    >
      <GripVertical className="size-4" />
    </button>
  );
}
