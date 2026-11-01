// Class names are written out in full (not built from strings) because Tailwind
// finds the classes to generate by scanning source files for complete names.
const groups = [
  {
    name: "Surfaces",
    tokens: [
      ["background", "bg-background"],
      ["surface", "bg-surface"],
      ["surface-raised", "bg-surface-raised"],
      ["muted", "bg-muted"],
      ["border", "bg-border"],
      ["foreground", "bg-foreground"],
      ["muted-foreground", "bg-muted-foreground"],
    ],
  },
  {
    name: "Brand",
    tokens: [
      ["primary", "bg-primary"],
      ["primary-subtle", "bg-primary-subtle"],
      ["ring", "bg-ring"],
    ],
  },
  {
    name: "Meaning",
    tokens: [
      ["positive", "bg-positive"],
      ["positive-subtle", "bg-positive-subtle"],
      ["negative", "bg-negative"],
      ["negative-subtle", "bg-negative-subtle"],
      ["warning", "bg-warning"],
      ["warning-subtle", "bg-warning-subtle"],
    ],
  },
  {
    name: "Charts",
    tokens: [
      ["chart-1", "bg-chart-1"],
      ["chart-2", "bg-chart-2"],
      ["chart-3", "bg-chart-3"],
      ["chart-4", "bg-chart-4"],
      ["chart-5", "bg-chart-5"],
    ],
  },
] as const;

export function ColorSwatches() {
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.name}>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">{group.name}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {group.tokens.map(([name, className]) => (
              <div key={name} className="space-y-2">
                <div
                  className={`h-16 rounded-xl border border-border shadow-elevation-1 ${className}`}
                />
                <p className="font-mono text-caption">--{name}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
