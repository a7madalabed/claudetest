/**
 * A legend is always present for 2+ series. Swatches MIRROR the mark (a rect for
 * bars, a short line for lines) and the TEXT stays in text colours — series
 * colours like yellow or aqua are illegible as text.
 */
export function Legend({
  items,
}: {
  items: Array<{ label: string; color: string; mark?: "rect" | "line" }>;
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
      {items.map(({ label, color, mark = "rect" }) => (
        <li key={label} className="flex items-center gap-1.5">
          {mark === "rect" ? (
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: color }} />
          ) : (
            <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: color }} />
          )}
          {label}
        </li>
      ))}
    </ul>
  );
}
