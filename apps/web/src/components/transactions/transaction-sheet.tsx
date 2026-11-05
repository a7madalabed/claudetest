"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  currencyDecimals,
  parseMoney,
  type AccountDto,
  type CategoryDto,
  type TransactionDto,
} from "@ledgerly/shared";
import { ArrowLeftRight, Lock, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select, SelectItem } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { currencySymbol, minorToInput } from "@/lib/money-input";
import { spring } from "@/lib/motion";
import {
  newTransactionId,
  useCreateTransaction,
  useCreateTransfer,
  useUpdateTransaction,
} from "@/lib/query/transactions";
import { cn } from "@/lib/utils";
import { NoAccountsNotice } from "@/components/overview/no-accounts";
import { CategoryPicker } from "./category-picker";

export type SheetMode = { type: "create" } | { type: "edit"; transaction: TransactionDto };

const Kind = z.enum(["expense", "income", "transfer"]);

/**
 * The FORM's schema (what the user edits), separate from the API's schema (what
 * we send). The form holds the amount as typed text ("1,234.5"); it becomes
 * minor units only on submit, via parseMoney — never through a float.
 */
const FormSchema = z
  .object({
    kind: Kind,
    amount: z.string().trim().min(1, "Enter an amount"),
    description: z.string().trim().min(1, "Add a short description").max(200),
    occurredOn: z.iso.date("Pick a date"),
    accountId: z.string().min(1, "Choose an account"),
    toAccountId: z.string(),
    categoryId: z.string().nullable(),
    notes: z.string().max(2000),
  })
  .refine((v) => v.kind !== "transfer" || (v.toAccountId && v.toAccountId !== v.accountId), {
    message: "Choose a different account to move money to",
    path: ["toAccountId"],
  });
type FormValues = z.infer<typeof FormSchema>;

const LAST_ACCOUNT_KEY = "ledgerly:last-account";
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function defaults(mode: SheetMode, accounts: AccountDto[]): FormValues {
  if (mode.type === "edit") {
    const t = mode.transaction;
    const currency = accounts.find((a) => a.id === t.accountId)?.currency ?? "USD";
    return {
      kind: t.transferId ? "transfer" : t.amountMinor > 0 ? "income" : "expense",
      amount: minorToInput(t.amountMinor, currency),
      description: t.description,
      occurredOn: t.occurredOn,
      accountId: t.accountId,
      toAccountId: "",
      categoryId: t.categoryId,
      notes: t.notes ?? "",
    };
  }
  // Remember the last account used: most people log most spending from one card.
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    /* storage unavailable (private mode) — fine */
  }
  const active = accounts.filter((a) => !a.archived);
  const accountId = active.find((a) => a.id === last)?.id ?? active[0]?.id ?? "";
  return {
    kind: "expense",
    amount: "",
    description: "",
    occurredOn: todayIso(),
    accountId,
    toAccountId: "",
    categoryId: null,
    notes: "",
  };
}

export function TransactionSheet({
  open,
  onOpenChange,
  mode,
  householdId,
  accounts,
  categories,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SheetMode;
  householdId: string;
  accounts: AccountDto[] | undefined;
  categories: CategoryDto[] | undefined;
  onDelete: (transaction: TransactionDto) => void;
}) {
  const create = useCreateTransaction(householdId, categories);
  const update = useUpdateTransaction(householdId, categories);
  const transfer = useCreateTransfer(householdId);
  const activeAccounts = useMemo(() => (accounts ?? []).filter((a) => !a.archived), [accounts]);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    mode: "onTouched",
    defaultValues: defaults(mode, activeAccounts),
  });
  const { errors } = form.formState;
  const [kind, accountId] = useWatch({ control: form.control, name: ["kind", "accountId"] });

  // Reset the form each time the sheet opens (new transaction, or a different one to edit).
  useEffect(() => {
    if (open) form.reset(defaults(mode, activeAccounts));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when (re)opening
  }, [open, mode]);

  // Opened before the accounts arrived (a quick "N" right after the page loads)?
  // Fill in the default account when they do — but never overwrite a choice.
  // Found as a flaky end-to-end test in Stage 13.
  useEffect(() => {
    if (!open || form.getValues("accountId")) return;
    const fallback = defaults(mode, activeAccounts).accountId;
    if (fallback) {
      form.setValue("accountId", fallback, { shouldValidate: form.formState.isSubmitted });
    }
  }, [open, mode, activeAccounts, form]);

  const editing = mode.type === "edit" ? mode.transaction : null;
  const lockedTransfer = Boolean(editing?.transferId);
  const currency = accounts?.find((a) => a.id === accountId)?.currency ?? "USD";

  const onSubmit = form.handleSubmit((values) => {
    const amount = parseMoney(values.amount, currency);
    if (!amount) {
      form.setError(
        "amount",
        { message: `Enter an amount like ${currencyDecimals(currency) ? "12.50" : "1250"}` },
        { shouldFocus: true },
      );
      return;
    }
    const signed = values.kind === "expense" ? -amount : amount;
    const notes = values.notes.trim() || null;

    try {
      localStorage.setItem(LAST_ACCOUNT_KEY, values.accountId);
    } catch {
      /* ignore */
    }

    if (editing) {
      const changes = lockedTransfer
        ? { description: values.description, notes }
        : {
            description: values.description,
            notes,
            amountMinor: signed,
            occurredOn: values.occurredOn,
            accountId: values.accountId,
            categoryId: values.categoryId,
          };
      update.mutate({ id: editing.id, changes, previous: editing });
    } else if (values.kind === "transfer") {
      transfer.mutate({
        fromAccountId: values.accountId,
        toAccountId: values.toAccountId,
        amountMinor: amount,
        occurredOn: values.occurredOn,
        description: values.description,
      });
    } else {
      create.mutate({
        id: newTransactionId(),
        accountId: values.accountId,
        categoryId: values.categoryId,
        amountMinor: signed,
        occurredOn: values.occurredOn,
        description: values.description,
        notes,
      });
      toast.success(values.kind === "income" ? "Income added" : "Expense added", {
        description: values.description,
      });
    }
    // Optimistic: close immediately. The list already shows the change; if the
    // server disagrees, the change is rolled back and an error toast explains why.
    onOpenChange(false);
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[28rem]" aria-describedby={undefined}>
        {/* Nothing to record INTO yet: say how to fix that, instead of an empty "Account" list. */}
        {!editing && accounts !== undefined && activeAccounts.length === 0 ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-6 pt-5 pb-4">
              <SheetTitle className="text-title">New transaction</SheetTitle>
            </div>
            <div className="px-6 py-5">
              <NoAccountsNotice householdId={householdId} canEdit />
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex h-full flex-col">
            <div className="border-b border-border px-6 pt-5 pb-4">
              <SheetTitle className="text-title">
                {editing ? "Edit transaction" : "New transaction"}
              </SheetTitle>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {/* Expense / Income / Transfer */}
              <Controller
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <div
                    role="radiogroup"
                    aria-label="Type"
                    className="grid grid-cols-3 rounded-xl bg-muted p-1"
                  >
                    {Kind.options.map((option) => {
                      const disabled =
                        Boolean(editing) && (option === "transfer" || lockedTransfer);
                      return (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={field.value === option}
                          disabled={disabled && field.value !== option}
                          onClick={() => {
                            field.onChange(option);
                            if (option !== kind) form.setValue("categoryId", null); // categories differ per kind
                          }}
                          className={cn(
                            "relative rounded-lg py-1.5 text-sm font-medium capitalize transition-colors disabled:opacity-40",
                            field.value === option
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {field.value === option && (
                            <motion.span
                              layoutId="kind-pill"
                              transition={spring.snappy}
                              className="absolute inset-0 rounded-lg bg-surface shadow-elevation-1"
                            />
                          )}
                          <span className="relative">{option}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              />

              {lockedTransfer && (
                <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
                  <Lock className="mt-0.5 size-4 shrink-0" />
                  This is half of a transfer. You can rename it or add notes; to change the amount,
                  delete the transfer and record it again.
                </p>
              )}

              <Field label="Amount" error={errors.amount?.message}>
                <Input
                  {...form.register("amount")}
                  prefix={currencySymbol(currency)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={currencyDecimals(currency) ? "0.00" : "0"}
                  disabled={lockedTransfer}
                  autoFocus={!editing}
                  className={cn(
                    "h-12 text-xl font-semibold tabular-nums",
                    kind === "income" && "text-positive",
                    kind === "expense" && "text-negative",
                  )}
                />
              </Field>

              <Field label="Description" error={errors.description?.message}>
                <Input
                  {...form.register("description")}
                  placeholder={kind === "income" ? "e.g. Salary" : "e.g. Groceries at Trader Joe's"}
                  autoComplete="off"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Date" error={errors.occurredOn?.message}>
                  {/* The native date picker: accessible, localised and touch-friendly on every device. */}
                  <Input type="date" {...form.register("occurredOn")} disabled={lockedTransfer} />
                </Field>
                <Field
                  label={kind === "transfer" ? "From account" : "Account"}
                  error={errors.accountId?.message}
                >
                  <Controller
                    control={form.control}
                    name="accountId"
                    render={({ field }) => (
                      <Select
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                        placeholder="Choose…"
                        disabled={lockedTransfer}
                        aria-label={kind === "transfer" ? "From account" : "Account"}
                      >
                        {activeAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </Select>
                    )}
                  />
                </Field>
              </div>

              {kind === "transfer" && !editing && (
                <Field label="To account" error={errors.toAccountId?.message}>
                  <Controller
                    control={form.control}
                    name="toAccountId"
                    render={({ field }) => (
                      <Select
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                        placeholder="Choose…"
                        aria-label="To account"
                      >
                        {activeAccounts
                          .filter((a) => a.id !== accountId)
                          .map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                      </Select>
                    )}
                  />
                </Field>
              )}

              {kind !== "transfer" && (
                <Field label="Category">
                  <Controller
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <CategoryPicker
                        categories={categories}
                        value={field.value}
                        onChange={field.onChange}
                        kind={kind === "income" ? "income" : "expense"}
                      />
                    )}
                  />
                </Field>
              )}

              {kind === "transfer" && editing && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ArrowLeftRight className="size-4" /> Transfers move money between your accounts
                  and aren&apos;t counted as income or spending.
                </p>
              )}

              <Field label="Notes" error={errors.notes?.message}>
                <textarea
                  {...form.register("notes")}
                  rows={3}
                  placeholder="Optional"
                  className="w-full resize-none rounded-lg border border-input bg-surface px-3 py-2 text-sm shadow-elevation-1 outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20"
                />
              </Field>
            </div>

            <div className="flex items-center gap-2 border-t border-border px-6 py-4">
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-negative hover:bg-negative-subtle"
                  onClick={() => {
                    onOpenChange(false);
                    onDelete(editing);
                  }}
                >
                  <Trash2 /> Delete
                </Button>
              )}
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editing ? "Save" : kind === "transfer" ? "Record transfer" : `Add ${kind}`}
                </Button>
              </div>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
