"use client";

import { formatMoney, type MinorUnits } from "@ledgerly/shared";
import { animate, useMotionValue, useReducedMotion, useTransform, motion } from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * A money amount that smoothly "counts" to its new value whenever it changes —
 * the effect you see on balances in Revolut, Stripe or Robinhood.
 *
 * Performance note: the number is animated with a Motion *MotionValue*, which
 * updates the DOM text directly on every frame WITHOUT re-rendering React.
 * Re-rendering a component 60 times per second would be wasteful.
 */
/** Intl writes a negative with an ASCII hyphen; `Amount` uses a true minus (−). One sign everywhere. */
const withMinus = (text: string) => text.replace(/^-/, "−");

export function AnimatedMoney({
  value,
  currency = "USD",
  className,
}: {
  value: MinorUnits;
  currency?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(value);
  // Always display a whole number of minor units — never a fractional cent.
  const text = useTransform(motionValue, (latest) =>
    withMinus(formatMoney(Math.round(latest), currency)),
  );

  useEffect(() => {
    if (reduceMotion) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, { duration: 0.8, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [value, reduceMotion, motionValue]);

  return (
    <span className={cn("tabular-nums", className)}>
      {/* Screen readers get the final value once, not every intermediate frame. */}
      <span className="sr-only">{withMinus(formatMoney(value, currency))}</span>
      <motion.span aria-hidden>{text}</motion.span>
    </span>
  );
}

/**
 * A signed transaction amount: "+$1,200.00" in green or "−$54.20" in red.
 * Meaning is never conveyed by colour alone (WCAG 1.4.1) — the sign carries it too,
 * so colour-blind users and screen readers get the same information.
 */
export function Amount({
  value,
  currency = "USD",
  className,
}: {
  value: MinorUnits;
  currency?: string;
  className?: string;
}) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        value > 0 && "text-positive",
        value < 0 && "text-negative",
        className,
      )}
    >
      {sign}
      {formatMoney(Math.abs(value), currency)}
    </span>
  );
}
