"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * An error BOUNDARY: if anything inside /app throws while rendering, this
 * replaces just the page area — the sidebar keeps working, and the user can
 * retry without a full reload.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-negative-subtle text-negative">
        <AlertTriangle className="size-6" />
      </span>
      <h1 className="text-title">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load this page. It&apos;s probably temporary.
        {error.digest && (
          <span className="mt-2 block font-mono text-caption">Reference: {error.digest}</span>
        )}
      </p>
      <Button onClick={reset} variant="outline">
        <RotateCcw /> Try again
      </Button>
    </div>
  );
}
