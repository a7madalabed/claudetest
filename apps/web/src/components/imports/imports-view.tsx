"use client";

import type { ImportDto, ImportUploadResult } from "@ledgerly/shared";
import { FileSpreadsheet } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { NoAccountsNotice } from "@/components/overview/no-accounts";
import { useCurrentHousehold } from "@/components/app-shell/household-context";
import { timeAgo } from "@/components/app-shell/notification-bell";
import { Page } from "@/components/app-shell/page";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Select, SelectItem } from "@/components/ui/select";
import { errorMessage } from "@/lib/api/errors";
import { ease } from "@/lib/motion";
import {
  useDiscardImport,
  useImports,
  useStartImport,
  useUploadImport,
} from "@/lib/query/automation";
import { useAccounts } from "@/lib/query/hooks";
import { Dropzone } from "./dropzone";
import { MappingStep } from "./mapping-step";
import { ProgressStep, UndoButton } from "./progress-step";

type Step =
  | { name: "upload" }
  | { name: "map"; upload: ImportUploadResult }
  | { name: "run"; importId: string };

const STEPS = ["Upload", "Match columns", "Import"] as const;
const stepIndex = (step: Step) => (step.name === "upload" ? 0 : step.name === "map" ? 1 : 2);

const statusBadge: Record<
  ImportDto["status"],
  { label: string; tone: "positive" | "warning" | "negative" | "neutral" | "primary" }
> = {
  uploaded: { label: "Not started", tone: "neutral" },
  queued: { label: "Queued", tone: "primary" },
  processing: { label: "Importing", tone: "primary" },
  completed: { label: "Done", tone: "positive" },
  failed: { label: "Failed", tone: "negative" },
  reverted: { label: "Undone", tone: "neutral" },
};

export function ImportsView({ householdId }: { householdId: string }) {
  const household = useCurrentHousehold();
  const canEdit = household?.role !== "viewer";
  const accounts = useAccounts(householdId);
  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const [accountId, setAccountId] = useState<string | null>(null);
  const chosen = accountId ?? active[0]?.id;
  const currency = active.find((a) => a.id === chosen)?.currency ?? "USD";

  const [step, setStep] = useState<Step>({ name: "upload" });
  const upload = useUploadImport(householdId);
  const start = useStartImport(householdId);
  const discard = useDiscardImport(householdId);
  const history = useImports(householdId);

  return (
    <Page title="Imports" description="Bring in transactions from your bank's CSV export.">
      {/* Where am I in the flow? */}
      <ol className="mb-8 flex items-center gap-2 text-sm" aria-label="Import steps">
        {STEPS.map((label, i) => {
          const current = stepIndex(step) === i;
          const done = stepIndex(step) > i;
          return (
            <li
              key={label}
              className="flex items-center gap-2"
              aria-current={current ? "step" : undefined}
            >
              <span
                className={
                  current || done
                    ? "flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                    : "flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                }
              >
                {i + 1}
              </span>
              {/* On phones only the current step is named; the numbers carry the rest. */}
              <span className={current ? "font-medium" : "hidden text-muted-foreground sm:inline"}>
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <span className="mx-1 h-px w-6 bg-border sm:w-10" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step.name}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.25, ease: ease.outQuint }}
        >
          {step.name === "upload" && accounts.data && active.length === 0 && (
            <NoAccountsNotice
              householdId={householdId}
              canEdit={canEdit}
              className="mx-auto max-w-2xl"
            >
              A bank statement is imported INTO an account. Add the account it comes from, then come
              back here.
            </NoAccountsNotice>
          )}
          {step.name === "upload" && !(accounts.data && active.length === 0) && (
            <div className="mx-auto max-w-2xl space-y-5">
              <Field label="Import into">
                <Select
                  value={chosen}
                  onValueChange={setAccountId}
                  placeholder="Choose an account…"
                  aria-label="Import into"
                >
                  {active.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </Select>
              </Field>
              <Dropzone
                busy={upload.isPending}
                disabled={!canEdit || !chosen}
                onFile={async (file) => {
                  const text = await file.text();
                  upload.mutate(
                    { accountId: chosen!, file, text },
                    {
                      onSuccess: (result) => setStep({ name: "map", upload: result }),
                      onError: (error) => toast.error(errorMessage(error)),
                    },
                  );
                }}
              />
              <p className="text-caption text-muted-foreground">
                {canEdit
                  ? "Tip: most banks have Statements → Download → CSV. Choose a date range; overlapping ranges are fine — rows you already have are skipped."
                  : "Viewers can't import. Ask an owner or editor of this household."}
              </p>
            </div>
          )}

          {step.name === "map" && (
            <MappingStep
              upload={step.upload}
              currency={currency}
              starting={start.isPending}
              onCancel={() => {
                discard.mutate(step.upload.import.id);
                setStep({ name: "upload" });
              }}
              onStart={(mapping) =>
                start.mutate(
                  { id: step.upload.import.id, mapping },
                  { onSuccess: () => setStep({ name: "run", importId: step.upload.import.id }) },
                )
              }
            />
          )}

          {step.name === "run" && (
            <ProgressStep
              householdId={householdId}
              importId={step.importId}
              onAnother={() => setStep({ name: "upload" })}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── History ─────────────────────────────────────────────────────── */}
      {history.data && history.data.some((i) => i.status !== "uploaded") && (
        <section aria-labelledby="history" className="mt-14 space-y-3">
          <h2 id="history" className="text-sm font-medium text-muted-foreground">
            Recent imports
          </h2>
          <Card className="divide-y divide-border p-0">
            {history.data
              .filter((i) => i.status !== "uploaded")
              .map((item) => {
                const badge = statusBadge[item.status];
                return (
                  <div key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <FileSpreadsheet className="size-4" />
                    </span>
                    <div className="min-w-[12rem] flex-1">
                      <p className="truncate text-sm font-medium">{item.fileName}</p>
                      <p className="text-caption text-muted-foreground">
                        {item.accountName} · {timeAgo(item.createdAt)}
                        {item.status === "completed" &&
                          ` · ${item.importedCount} added${item.duplicateCount ? `, ${item.duplicateCount} skipped` : ""}`}
                      </p>
                    </div>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    {item.status === "completed" && canEdit && (
                      <UndoButton householdId={householdId} importId={item.id} />
                    )}
                  </div>
                );
              })}
          </Card>
        </section>
      )}
    </Page>
  );
}
