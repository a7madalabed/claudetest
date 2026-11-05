"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { parseMoney, type AccountDto } from "@ledgerly/shared";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Select, SelectItem } from "@/components/ui/select";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { currencySymbol, minorToInput } from "@/lib/money-input";
import { useCreateAccount, useDeleteAccount, useUpdateAccount } from "@/lib/query/accounts";

export const ACCOUNT_TYPES: Array<{ value: AccountDto["type"]; label: string }> = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit_card", label: "Credit card" },
  { value: "cash", label: "Cash" },
  { value: "investment", label: "Investment" },
  { value: "loan", label: "Loan" },
];

/** For these, people think in "how much I owe", not in a negative balance. */
const owes = (type: AccountDto["type"]) => type === "credit_card" || type === "loan";

const FormSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name").max(100),
  type: z.enum(["checking", "savings", "credit_card", "cash", "investment", "loan"]),
  balance: z.string().trim(),
});
type FormValues = z.infer<typeof FormSchema>;

export function AccountDialog({
  open,
  onOpenChange,
  householdId,
  currency,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  /** The household's currency: every account uses it (see the API). */
  currency: string;
  account: AccountDto | null;
}) {
  const create = useCreateAccount(householdId);
  const update = useUpdateAccount(householdId);
  const remove = useDeleteAccount(householdId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setConfirmDelete(false);
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: "", type: "checking", balance: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const type = useWatch({ control: form.control, name: "type" });

  useEffect(() => {
    if (!open) return;
    form.reset(
      account
        ? {
            name: account.name,
            type: account.type,
            balance: account.openingBalanceMinor
              ? minorToInput(account.openingBalanceMinor, account.currency)
              : "",
          }
        : { name: "", type: "checking", balance: "" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when (re)opening
  }, [open, account?.id]);

  const onSubmit = form.handleSubmit(async (values) => {
    const amount = values.balance === "" ? 0 : parseMoney(values.balance, currency);
    if (amount === null) {
      form.setError("balance", { message: "Enter an amount like 1250.00" }, { shouldFocus: true });
      return;
    }
    // A credit card or loan balance is money OWED: stored as a negative balance.
    const openingBalanceMinor = owes(values.type) ? -amount : amount;
    try {
      if (account) {
        await update.mutateAsync({
          id: account.id,
          changes: { name: values.name, type: values.type, openingBalanceMinor },
        });
        toast.success("Account updated");
      } else {
        await create.mutateAsync({ name: values.name, type: values.type, openingBalanceMinor });
        toast.success(`Account “${values.name}” added`);
      }
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error) && error.code === "account_name_taken") {
        form.setError("name", { message: error.detail ?? error.title }, { shouldFocus: true });
      } else {
        toast.error(errorMessage(error));
      }
    }
  });

  const setArchived = async (archived: boolean) => {
    if (!account) return;
    try {
      await update.mutateAsync({ id: account.id, changes: { archived } });
      toast.success(archived ? `“${account.name}” archived` : `“${account.name}” is back`);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const onDelete = async () => {
    if (!account) return;
    if (!confirmDelete) return setConfirmDelete(true);
    try {
      await remove.mutateAsync(account.id);
      toast.success(`“${account.name}” deleted`);
      onOpenChange(false);
    } catch (error) {
      // An account with history can't be deleted (the API refuses): archive it instead.
      toast.error(errorMessage(error));
      setConfirmDelete(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{account ? "Edit account" : "Add an account"}</DialogTitle>
            <DialogDescription>
              A bank account, card, wallet or loan. Its balance follows the transactions you record
              or import.
            </DialogDescription>
          </DialogHeader>

          <Field label="Name" error={errors.name?.message}>
            <Input {...form.register("name")} placeholder="e.g. Everyday checking" autoFocus />
          </Field>

          <Field label="Type" error={errors.type?.message}>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} aria-label="Type">
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </Select>
              )}
            />
          </Field>

          <Field
            label={owes(type) ? "Amount owed" : account ? "Starting balance" : "Balance today"}
            error={errors.balance?.message}
            description={
              account
                ? "The balance before the first transaction recorded here."
                : `In ${currency}. Leave empty to start from zero.`
            }
          >
            <Input
              {...form.register("balance")}
              inputMode="decimal"
              autoComplete="off"
              prefix={currencySymbol(currency)}
              placeholder="0.00"
              className="font-semibold tabular-nums"
            />
          </Field>

          <DialogFooter className="items-center">
            {account && (
              <div className="flex gap-1 sm:mr-auto">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setArchived(!account.archived)}
                >
                  {account.archived ? <ArchiveRestore /> : <Archive />}
                  {account.archived ? "Unarchive" : "Archive"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-negative hover:bg-negative-subtle"
                  onClick={onDelete}
                >
                  <Trash2 /> {confirmDelete ? "Click again to delete" : "Delete"}
                </Button>
              </div>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {account ? "Save" : "Add account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
