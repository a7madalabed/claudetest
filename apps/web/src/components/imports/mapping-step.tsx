"use client";

import {
  applyMapping,
  parseImportDate,
  type DateFormat,
  type ImportMapping,
  type ImportUploadResult,
} from "@ledgerly/shared";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Amount } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Select, SelectItem } from "@/components/ui/select";
import { formatDay } from "@/lib/dates";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const FORMAT_LABEL: Record<DateFormat, string> = {
  YMD: "Year-month-day",
  MDY: "Month/day/year (US)",
  DMY: "Day/month/year",
};

const longDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  id,
}: {
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (value: T) => void;
  label: string;
  id: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-xl bg-muted p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "relative flex-1 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
            value === option.value
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === option.value && (
            <motion.span
              layoutId={`${id}-pill`}
              transition={spring.snappy}
              className="absolute inset-0 rounded-lg bg-surface shadow-elevation-1"
            />
          )}
          <span className="relative">{option.label}</span>
          {option.hint && (
            <span className="relative block text-[11px] font-normal text-muted-foreground">
              {option.hint}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Defined at module level: a component created inside render would remount on every keystroke. */
function ColumnSelect({
  value,
  onChange,
  label,
  labels,
}: {
  value: number;
  onChange: (column: number) => void;
  label: string;
  labels: string[];
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} aria-label={label}>
      {labels.map((text, i) => (
        <SelectItem key={i} value={String(i)}>
          {text}
        </SelectItem>
      ))}
    </Select>
  );
}

/**
 * Step 2: check what the file means. Everything here is computed IN THE
 * BROWSER with the same applyMapping() the background job will use, so the
 * preview is exactly what will be imported — no surprises after you click.
 */
export function MappingStep({
  upload,
  currency,
  onCancel,
  onStart,
  starting,
}: {
  upload: ImportUploadResult;
  currency: string;
  onCancel: () => void;
  onStart: (mapping: ImportMapping) => void;
  starting: boolean;
}) {
  const { rows, guess } = upload.preview;
  const width = Math.max(...rows.map((r) => r.length));
  const [mapping, setMapping] = useState<ImportMapping>(
    guess?.mapping ?? {
      hasHeader: true,
      dateColumn: 0,
      dateFormat: "YMD",
      descriptionColumn: Math.min(1, width - 1),
      amount: { type: "single", column: Math.min(2, width - 1), negate: false },
    },
  );
  const set = (patch: Partial<ImportMapping>) => setMapping((m) => ({ ...m, ...patch }));

  const header = mapping.hasHeader ? rows[0] : undefined;
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const columnLabel = (i: number) =>
    header?.[i]
      ? header[i]
      : `Column ${i + 1}${body[0]?.[i] ? ` — “${body[0][i].slice(0, 18)}”` : ""}`;
  const columnOptions = Array.from({ length: width }, (_, i) => i);
  const totalRows = upload.import.totalRows - (mapping.hasHeader ? 1 : 0);

  const mapped = useMemo(
    () => body.slice(0, 10).map((row) => applyMapping(row, mapping, currency)),
    [body, mapping, currency],
  );
  const failing = mapped.filter((m) => !m.ok).length;
  const ambiguous = (guess?.dateFormats.length ?? 0) > 1;
  const firstDate = body[0]?.[mapping.dateColumn] ?? "";

  const labels = columnOptions.map(columnLabel);

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <Card className="h-fit space-y-5 p-5">
        <div>
          <h2 className="font-semibold">Match the columns</h2>
          <p className="text-sm text-muted-foreground">
            {guess
              ? "We guessed from your file. Check the preview, then adjust if needed."
              : "We couldn't recognise this layout — tell us which column is which."}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={mapping.hasHeader}
            onCheckedChange={(checked) => set({ hasHeader: checked === true })}
          />
          First row is a header
        </label>

        <Field label="Date">
          <ColumnSelect
            labels={labels}
            value={mapping.dateColumn}
            onChange={(dateColumn) => set({ dateColumn })}
            label="Date column"
          />
        </Field>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Date format</p>
          <Select
            value={mapping.dateFormat}
            onValueChange={(v) => set({ dateFormat: v as DateFormat })}
            aria-label="Date format"
          >
            {(["YMD", "MDY", "DMY"] as const).map((format) => {
              const parsed = parseImportDate(firstDate, format);
              return (
                <SelectItem key={format} value={format}>
                  {FORMAT_LABEL[format]}
                  <span className="text-muted-foreground">
                    {" "}
                    · {parsed ? longDate.format(new Date(`${parsed}T00:00:00Z`)) : "doesn't fit"}
                  </span>
                </SelectItem>
              );
            })}
          </Select>
          {ambiguous && (
            <p className="flex gap-1.5 rounded-lg bg-warning-subtle p-2.5 text-caption text-warning">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Dates like “{firstDate}” could be month-first or day-first. Check the preview: is
                that{" "}
                <strong>
                  {mapped[0]?.ok
                    ? longDate.format(new Date(`${mapped[0].occurredOn}T00:00:00Z`))
                    : "right"}
                </strong>
                ?
              </span>
            </p>
          )}
        </div>

        <Field label="Description">
          <ColumnSelect
            labels={labels}
            value={mapping.descriptionColumn}
            onChange={(descriptionColumn) => set({ descriptionColumn })}
            label="Description column"
          />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-medium">Amount</p>
          <Segmented
            id="amount-type"
            label="Amount layout"
            value={mapping.amount.type}
            onChange={(type) =>
              set({
                amount:
                  type === "single"
                    ? { type, column: Math.min(2, width - 1), negate: false }
                    : {
                        type,
                        debitColumn: Math.min(2, width - 1),
                        creditColumn: Math.min(3, width - 1),
                      },
              })
            }
            options={[
              { value: "single", label: "One column" },
              { value: "split", label: "Out + in columns" },
            ]}
          />
          {mapping.amount.type === "single" ? (
            <>
              <ColumnSelect
                labels={labels}
                value={mapping.amount.column}
                onChange={(column) =>
                  set({
                    amount: {
                      type: "single",
                      column,
                      negate: mapping.amount.type === "single" && mapping.amount.negate,
                    },
                  })
                }
                label="Amount column"
              />
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={mapping.amount.negate}
                  onCheckedChange={(checked) =>
                    mapping.amount.type === "single" &&
                    set({ amount: { ...mapping.amount, negate: checked === true } })
                  }
                />
                <span>
                  Spending shows as positive
                  <span className="block text-caption text-muted-foreground">
                    Common in credit card exports. Flips every sign.
                  </span>
                </span>
              </label>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Money out">
                <ColumnSelect
                  labels={labels}
                  value={mapping.amount.debitColumn}
                  onChange={(debitColumn) =>
                    mapping.amount.type === "split" &&
                    set({ amount: { ...mapping.amount, debitColumn } })
                  }
                  label="Money out column"
                />
              </Field>
              <Field label="Money in">
                <ColumnSelect
                  labels={labels}
                  value={mapping.amount.creditColumn}
                  onChange={(creditColumn) =>
                    mapping.amount.type === "split" &&
                    set({ amount: { ...mapping.amount, creditColumn } })
                  }
                  label="Money in column"
                />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <p className="text-sm font-medium">Preview</p>
            <p className="text-caption text-muted-foreground">
              First {mapped.length} of {totalRows.toLocaleString("en-US")} rows
              {failing > 0 && <span className="text-warning"> · {failing} can&apos;t be read</span>}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-caption text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Description</th>
                  <th className="px-5 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {mapped.map((row, i) => (
                  <motion.tr
                    key={i}
                    layout="position"
                    className={cn(!row.ok && "bg-warning-subtle/50")}
                  >
                    {row.ok ? (
                      <>
                        <td className="px-5 py-2.5 whitespace-nowrap text-muted-foreground">
                          <CircleCheck
                            className="mr-1.5 inline size-3.5 text-positive"
                            aria-label="OK"
                          />
                          {formatDay(row.occurredOn)}, {row.occurredOn.slice(0, 4)}
                        </td>
                        <td className="max-w-0 truncate px-2 py-2.5 font-medium">
                          {row.description}
                        </td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap">
                          <Amount value={row.amountMinor} currency={currency} />
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className="px-5 py-2.5 text-warning">
                        <CircleAlert className="mr-1.5 inline size-3.5" aria-hidden />
                        Row {i + 1 + (mapping.hasHeader ? 1 : 0)} will be skipped: {row.error}
                      </td>
                    )}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="text-caption text-muted-foreground">
          Rows you&apos;ve imported before are skipped automatically, so it&apos;s safe to import
          overlapping date ranges. Categories are filled in from how you&apos;ve categorised the
          same payee before.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onStart(mapping)} disabled={starting || failing === mapped.length}>
            Import {totalRows.toLocaleString("en-US")} rows
          </Button>
        </div>
      </div>
    </div>
  );
}
