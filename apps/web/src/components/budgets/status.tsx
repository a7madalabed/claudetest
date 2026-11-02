import type { BudgetStatus } from "@ledgerly/shared";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { STATUS_LABEL } from "@/lib/budgets";
import { cn } from "@/lib/utils";

const icons = { ok: CircleCheck, warning: TriangleAlert, over: CircleAlert } as const;
const tones = { ok: "text-positive", warning: "text-warning", over: "text-negative" } as const;

/** Status = icon + words + colour. Any ONE of the three is enough to understand it. */
export function StatusLabel({ status, className }: { status: BudgetStatus; className?: string }) {
  const Icon = icons[status];
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs font-medium", tones[status], className)}
    >
      <Icon className="size-3.5" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
