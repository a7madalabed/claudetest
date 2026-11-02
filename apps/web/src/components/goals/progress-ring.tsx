"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Progress towards ONE target, as a ring. A single ratio is the one case where
 * a circle reads well (it's a gauge, not a comparison between slices). The
 * track is a lighter step of the same hue; the number in the middle carries the
 * value, so the ring is never the only way to read it.
 */
export function ProgressRing({
  value,
  label,
  size = 72,
}: {
  value: number;
  label: string;
  size?: number;
}) {
  const reduceMotion = useReducedMotion();
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          style={{ stroke: "color-mix(in oklch, var(--chart-1) 18%, transparent)" }}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{ stroke: "var(--chart-1)" }}
          // pathLength animates from 0 → value: the ring "fills up" on a spring.
          initial={reduceMotion ? false : { pathLength: 0 }}
          animate={{ pathLength: Math.max(clamped, 0.001) }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">
        {Math.round(clamped * 100)}%
      </span>
    </div>
  );
}
