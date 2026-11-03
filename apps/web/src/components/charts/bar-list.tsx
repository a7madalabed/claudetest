"use client";

import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { CategoryIcon } from "@/lib/category-icons";
import { cn } from "@/lib/utils";
import { fullMoney } from "./format";

export interface BarListItem {
  id: string;
  label: string;
  icon?: string | null;
  valueMinor: number;
  share: number;
  /** Has subcategories to drill into. */
  drillable?: boolean;
}

/**
 * Ranked horizontal bars — the right form for "compare these parts" (a donut makes
 * close values impossible to compare). Largest first, ONE hue (the bars are one
 * series; colouring each differently would spend colour on nothing). Thin bars,
 * 4px rounded data end, square at the baseline; the value sits at the bar's tip.
 * Each row is a real button, so drill-down works with a keyboard too.
 */
export function BarList({
  items,
  currency,
  onSelect,
  color = "var(--chart-1)",
}: {
  items: BarListItem[];
  currency: string;
  onSelect?: (item: BarListItem) => void;
  color?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.valueMinor));
  return (
    <ul className="space-y-1">
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((item, index) => {
          const Wrapper = onSelect ? "button" : "div";
          return (
            <motion.li
              key={item.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30, delay: index * 0.025 }}
            >
              <Wrapper
                {...(onSelect && { type: "button" as const, onClick: () => onSelect(item) })}
                className={cn(
                  "group grid w-full grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm",
                  onSelect && "transition-colors hover:bg-muted/60",
                )}
              >
                {/* No aria-label: the visible text is the accessible name (WCAG 2.5.3,
                    "Label in Name"), so voice-control users can say what they see. */}
                {item.drillable && <span className="sr-only">Show subcategories of </span>}
                <span className="flex min-w-0 items-center gap-2">
                  <CategoryIcon
                    name={item.icon}
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="relative h-3">
                  <motion.span
                    className="absolute inset-y-0 left-0 rounded-r-[4px]"
                    style={{ background: color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(item.valueMinor / max) * 100}%` }}
                    transition={{
                      type: "spring",
                      stiffness: 160,
                      damping: 24,
                      delay: index * 0.03,
                    }}
                  />
                </span>
                <span className="flex items-center gap-1.5 text-right tabular-nums">
                  <span className="font-medium">{fullMoney(item.valueMinor, currency)}</span>
                  <span className="w-9 text-caption text-muted-foreground">
                    {Math.round(item.share * 100)}%
                  </span>
                  {onSelect && (
                    <ChevronRight
                      className={cn(
                        "size-3.5 text-muted-foreground transition-opacity",
                        item.drillable ? "opacity-60 group-hover:opacity-100" : "opacity-0",
                      )}
                    />
                  )}
                </span>
              </Wrapper>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
