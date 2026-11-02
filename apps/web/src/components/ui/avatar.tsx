import { cn } from "@/lib/utils";

/** Initials on a colour picked deterministically from the name (same name → same colour). */
const tones = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  const tone = tones[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % tones.length];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
        tone,
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
