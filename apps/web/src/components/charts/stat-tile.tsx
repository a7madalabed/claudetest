import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { AnimatedMoney } from "@/components/money";
import { cn } from "@/lib/utils";

/**
 * Stat tile contract: label · value · delta (vs a NAMED period) · optional trend.
 * The delta's colour = direction × whether that direction is good — spending
 * going UP is bad (red), income going up is good (green) — and it always carries
 * an arrow icon and words, never colour alone.
 */
export function StatTile({
  label,
  valueMinor,
  currency,
  delta,
  trend,
  hero = false,
  className,
}: {
  label: string;
  valueMinor: number | undefined;
  currency: string;
  delta?: { change: number; period: string; upIsGood: boolean } | null;
  trend?: ReactNode;
  hero?: boolean;
  className?: string;
}) {
  return (
    // min-w-0: a grid item otherwise refuses to shrink below its content's width,
    // and one wide tile would stretch the whole column off a phone's screen.
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-elevation-1",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        {valueMinor === undefined ? (
          <span
            className={cn(
              "block animate-pulse rounded-md bg-muted",
              hero ? "h-12 w-56" : "h-8 w-32",
            )}
          />
        ) : (
          // Proportional figures for big standalone numbers (tabular ones look loose at display sizes).
          <AnimatedMoney
            value={valueMinor}
            currency={currency}
            className={cn(
              "font-semibold tracking-tight [font-variant-numeric:proportional-nums]",
              hero ? "text-4xl sm:text-5xl" : "text-2xl",
            )}
          />
        )}
        {trend}
      </div>
      {delta !== undefined && <Delta delta={delta} />}
    </div>
  );
}

function Delta({ delta }: { delta: { change: number; period: string; upIsGood: boolean } | null }) {
  if (!delta || !Number.isFinite(delta.change)) {
    return (
      <p className="text-caption text-muted-foreground">
        No data for {delta?.period ?? "comparison"}
      </p>
    );
  }
  const flat = Math.abs(delta.change) < 0.005;
  const up = delta.change > 0;
  const good = flat ? null : up === delta.upIsGood;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="flex flex-wrap items-center gap-x-1 text-caption">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium whitespace-nowrap",
          good === true && "text-positive",
          good === false && "text-negative",
          good === null && "text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {flat ? "No change" : `${up ? "+" : "−"}${Math.abs(Math.round(delta.change * 100))}%`}
      </span>
      <span className="whitespace-nowrap text-muted-foreground">vs {delta.period}</span>
    </p>
  );
}
