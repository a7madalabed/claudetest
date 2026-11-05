import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** A titled card: one topic of the settings page. */
export function Section({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-0">
        <div className="space-y-1">
          <h2 className="text-title">{title}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        </div>
        {badge}
      </div>
      <div className="p-6">{children}</div>
    </Card>
  );
}
