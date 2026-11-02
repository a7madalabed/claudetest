"use client";

import type { ImportDto } from "@ledgerly/shared";
import { ArrowRight, Check, CircleAlert, CopyCheck, RotateCcw, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { spring } from "@/lib/motion";
import { useImport, useRevertImport } from "@/lib/query/automation";

/**
 * Step 3–4: the import runs in a background job; this view polls its status.
 * You can leave the page — the job keeps going, and the bell tells you when
 * it's done.
 */
export function ProgressStep({
  householdId,
  importId,
  onAnother,
}: {
  householdId: string;
  importId: string;
  onAnother: () => void;
}) {
  const { data } = useImport(householdId, importId);
  const status = data?.status ?? "queued";
  const running = status === "queued" || status === "processing";
  const share = data && data.totalRows > 0 ? data.processedRows / data.totalRows : 0;

  // When the job finishes, refresh everything it changed (transactions, budgets, bell).
  const queryClient = useQueryClient();
  useEffect(() => {
    if (status !== "completed" && status !== "failed") return;
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    void queryClient.invalidateQueries({ queryKey: ["households", householdId] });
  }, [status, householdId, queryClient]);

  return (
    <Card className="mx-auto max-w-2xl overflow-hidden p-0">
      <div className="space-y-6 p-6 sm:p-8">
        <div className="flex items-center gap-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={running ? "running" : status}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={spring.bouncy}
              className={
                status === "completed"
                  ? "flex size-12 items-center justify-center rounded-2xl bg-positive-subtle text-positive"
                  : status === "failed"
                    ? "flex size-12 items-center justify-center rounded-2xl bg-negative-subtle text-negative"
                    : status === "reverted"
                      ? "flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
                      : "flex size-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary"
              }
            >
              {status === "completed" ? (
                <Check className="size-6" strokeWidth={3} />
              ) : status === "failed" ? (
                <X className="size-6" strokeWidth={3} />
              ) : status === "reverted" ? (
                <RotateCcw className="size-6" />
              ) : (
                <Upload className="size-6 animate-pulse" />
              )}
            </motion.span>
          </AnimatePresence>
          <div className="min-w-0" aria-live="polite">
            <h2 className="truncate text-title">
              {status === "completed"
                ? "Import complete"
                : status === "failed"
                  ? "Import failed"
                  : status === "reverted"
                    ? "Import undone"
                    : `Importing ${data?.fileName ?? "your file"}…`}
            </h2>
            <p className="text-sm text-muted-foreground">
              {status === "queued"
                ? "Waiting for a worker to pick it up…"
                : status === "processing"
                  ? `${data?.processedRows.toLocaleString("en-US")} of ${data?.totalRows.toLocaleString("en-US")} rows`
                  : status === "failed"
                    ? data?.failureReason
                    : `${data?.fileName} → ${data?.accountName}`}
            </p>
          </div>
        </div>

        {running && (
          <div
            role="progressbar"
            aria-label="Import progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share * 100)}
            className="relative h-2.5 overflow-hidden rounded-full bg-muted"
          >
            {status === "queued" ? (
              // Indeterminate: we don't know how long the wait is, so don't pretend.
              <motion.div
                className="absolute inset-y-0 w-1/3 rounded-full bg-primary/60"
                animate={{ x: ["-100%", "300%"] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              />
            ) : (
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                animate={{ width: `${Math.max(4, share * 100)}%` }}
                // Stiff enough to keep up with 700 ms polls, soft enough to glide between them.
                transition={{ type: "spring", stiffness: 170, damping: 26 }}
              />
            )}
          </div>
        )}

        {data && (status === "completed" || status === "reverted") && (
          <Results data={data} householdId={householdId} />
        )}
      </div>

      {!running && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-6 py-4 sm:px-8">
          {status === "completed" && <UndoButton householdId={householdId} importId={importId} />}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onAnother}>
              Import another file
            </Button>
            {status === "completed" && (
              <Button asChild>
                <Link href={`/app/${householdId}/transactions`}>
                  View transactions <ArrowRight />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function Results({ data }: { data: ImportDto; householdId: string }) {
  const [showErrors, setShowErrors] = useState(false);
  const stats = [
    { label: "Imported", value: data.importedCount, icon: Check, tone: "text-positive" },
    {
      label: "Already imported",
      value: data.duplicateCount,
      icon: CopyCheck,
      tone: "text-muted-foreground",
    },
    {
      label: "Couldn't read",
      value: data.errorCount,
      icon: CircleAlert,
      tone: data.errorCount ? "text-warning" : "text-muted-foreground",
    },
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-3 gap-3">
        {stats.map(({ label, value, icon: Icon, tone }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.smooth, delay: 0.08 * i }}
            className="rounded-xl border border-border p-3"
          >
            <dt className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Icon className={`size-3.5 ${tone}`} aria-hidden /> {label}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">{value.toLocaleString("en-US")}</dd>
          </motion.div>
        ))}
      </dl>
      {data.errors.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowErrors((v) => !v)}
            aria-expanded={showErrors}
            className="text-sm font-medium text-primary hover:underline"
          >
            {showErrors ? "Hide" : "Show"} rows that were skipped
          </button>
          {showErrors && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-caption">
              {data.errors.map((e) => (
                <li key={e.row}>
                  <span className="font-medium">Row {e.row}:</span> {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function UndoButton({ householdId, importId }: { householdId: string; importId: string }) {
  const revert = useRevertImport(householdId);
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant="ghost"
      className="text-negative hover:bg-negative-subtle"
      disabled={revert.isPending}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setArmed(false);
        // mutateAsync, not mutate(…, { onSuccess }): this button disappears when the
        // import becomes "reverted", and per-call callbacks don't run after unmount.
        const result = await revert.mutateAsync(importId).catch(() => null);
        if (result)
          toast.success(
            `Removed ${result.importedCount.toLocaleString("en-US")} imported transactions`,
          );
      }}
    >
      <RotateCcw /> {armed ? "Click again to undo" : "Undo import"}
    </Button>
  );
}
