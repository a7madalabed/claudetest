import { cn } from "@/lib/utils";

/**
 * Initials on a colour picked deterministically from the name (same name → same
 * colour). The hue is a TINT behind normal ink: white text on the chart hues
 * themselves measured 2.2–3.2:1 contrast (WCAG asks 4.5:1) — found by axe, Stage 13.
 */
const tones = [
  "bg-chart-1/20 ring-chart-1/40",
  "bg-chart-2/20 ring-chart-2/40",
  "bg-chart-3/20 ring-chart-3/40",
  "bg-chart-4/20 ring-chart-4/40",
  "bg-chart-5/20 ring-chart-5/40",
];

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
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-foreground ring-1 ring-inset",
        tone,
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
