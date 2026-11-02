import { motion } from "motion/react";

/**
 * A single ratio against a target (savings rate vs a 20% goal). The unfilled
 * track is a lighter step of the SAME hue, so the whole bar reads as one thing.
 */
export function Meter({ value, target, label }: { value: number; target: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="space-y-1.5">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        className="relative h-2 overflow-hidden rounded-full"
        style={{ background: "color-mix(in oklch, var(--chart-1) 18%, transparent)" }}
      >
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: "var(--chart-1)" }}
          initial={{ width: 0 }}
          animate={{ width: `${clamped * 100}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        />
        <span
          aria-hidden
          className="absolute inset-y-[-2px] w-0.5 rounded-full bg-foreground/60"
          style={{ left: `${target * 100}%` }}
        />
      </div>
      <p className="text-caption text-muted-foreground">Goal {Math.round(target * 100)}%</p>
    </div>
  );
}
