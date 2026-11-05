"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "We couldn't load this" — with a way out (Stage 16).
 *
 * Before this, a failed request left a skeleton spinning forever, or an empty
 * list that looked like "you have no goals". In a money app that's worse than
 * an error: it's a wrong answer. Say what happened, and offer to try again.
 */
export function ErrorState({
  onRetry,
  title = "Couldn't load this",
  description = "It's probably temporary. Check your connection, then try again.",
  compact = false,
  className,
}: {
  onRetry: () => unknown;
  title?: string;
  description?: string;
  /** Inside a card or widget: smaller, no frame of its own. */
  compact?: boolean;
  className?: string;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 text-center",
        compact ? "px-4 py-8" : "rounded-2xl border border-border bg-surface px-6 py-14",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-negative-subtle text-negative">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
      <Button
        variant="outline"
        size="sm"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          try {
            await onRetry();
          } finally {
            setRetrying(false);
          }
        }}
      >
        <RotateCcw /> Try again
      </Button>
    </div>
  );
}

/** Failed, with nothing to show. (If an older copy is on screen, keep showing it.) */
export const loadFailed = (query: { isError: boolean; data: unknown }) =>
  query.isError && query.data === undefined;
