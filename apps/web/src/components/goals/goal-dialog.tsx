"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { parseMoney, type AccountDto, type GoalDto } from "@ledgerly/shared";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useHouseholdNow } from "@/components/app-shell/household-context";
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
import { localToday } from "@/lib/budgets";
import { currencySymbol, minorToInput } from "@/lib/money-input";
import { useCreateGoal, useDeleteGoal, useUpdateGoal } from "@/lib/query/budgets";

const FormSchema = z.object({
  name: z.string().trim().min(1, "Give the goal a name").max(60),
  accountId: z.string().min(1, "Choose the account you're saving in"),
  target: z.string().trim().min(1, "Enter a target amount"),
  targetDate: z.union([z.literal(""), z.iso.date("Pick a date")]),
});
type FormValues = z.infer<typeof FormSchema>;

export function GoalDialog({
  open,
  onOpenChange,
  householdId,
  goal,
  accounts,
  goals,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  goal: GoalDto | null;
  accounts: AccountDto[] | undefined;
  goals: GoalDto[] | undefined;
}) {
  const now = useHouseholdNow();
  const create = useCreateGoal(householdId);
  const update = useUpdateGoal(householdId);
  const remove = useDeleteGoal(householdId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Each opening starts un-armed. Adjusted DURING render (not in an effect) to avoid an extra pass.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setConfirmDelete(false);
  }
  // Savings goals live in accounts that hold money: not credit cards or loans.
  const savingsAccounts = (accounts ?? []).filter(
    (a) => !a.archived && !["credit_card", "loan"].includes(a.type),
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: "", accountId: "", target: "", targetDate: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const accountId = useWatch({ control: form.control, name: "accountId" });
  const currency = accounts?.find((a) => a.id === accountId)?.currency ?? "USD";
  // Goals track an account's WHOLE balance, so two goals on one account count the same money twice.
  const sharing = goals?.filter((g) => g.accountId === accountId && g.id !== goal?.id) ?? [];

  useEffect(() => {
    if (!open) return;
    form.reset(
      goal
        ? {
            name: goal.name,
            accountId: goal.accountId,
            target: minorToInput(goal.targetMinor, goal.currency),
            targetDate: goal.targetDate ?? "",
          }
        : {
            name: "",
            accountId: savingsAccounts.find((a) => a.type === "savings")?.id ?? "",
            target: "",
            targetDate: "",
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when (re)opening
  }, [open, goal?.id]);

  const onSubmit = form.handleSubmit(async (values) => {
    const targetMinor = parseMoney(values.target, currency);
    if (!targetMinor || targetMinor <= 0) {
      form.setError("target", { message: "Enter an amount like 5000" }, { shouldFocus: true });
      return;
    }
    if (values.targetDate && values.targetDate <= localToday(now)) {
      form.setError("targetDate", { message: "Pick a date in the future" }, { shouldFocus: true });
      return;
    }
    const targetDate = values.targetDate || null;
    try {
      if (goal) {
        await update.mutateAsync({
          id: goal.id,
          changes: { name: values.name, targetMinor, targetDate },
        });
        toast.success("Goal updated");
      } else {
        await create.mutateAsync({
          name: values.name,
          accountId: values.accountId,
          targetMinor,
          targetDate,
        });
        toast.success(`Goal “${values.name}” created`);
      }
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error) && error.status === 422) {
        form.setError("accountId", { message: error.detail ?? error.title });
      } else {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{goal ? "Edit goal" : "New savings goal"}</DialogTitle>
            <DialogDescription>
              Progress is the account&apos;s balance; the forecast comes from how fast it has grown
              over the last six months.
            </DialogDescription>
          </DialogHeader>

          <Field label="Name" error={errors.name?.message}>
            <Input {...form.register("name")} placeholder="e.g. Emergency fund" autoFocus />
          </Field>

          <Field
            label="Saving in"
            error={errors.accountId?.message}
            description={
              sharing.length
                ? `“${sharing[0]!.name}” already tracks this account — both goals would count the same money.`
                : goal
                  ? "To use another account, create a new goal."
                  : undefined
            }
          >
            <Controller
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <Select
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                  placeholder="Choose an account…"
                  disabled={Boolean(goal)}
                  aria-label="Saving in"
                >
                  {savingsAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </Select>
              )}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Target" error={errors.target?.message}>
              <Input
                {...form.register("target")}
                inputMode="decimal"
                autoComplete="off"
                prefix={currencySymbol(currency)}
                placeholder="10,000"
                className="font-semibold tabular-nums"
              />
            </Field>
            <Field label="By (optional)" error={errors.targetDate?.message}>
              <Input type="date" {...form.register("targetDate")} />
            </Field>
          </div>

          <DialogFooter className="items-center">
            {goal && (
              <Button
                type="button"
                variant="ghost"
                className="text-negative hover:bg-negative-subtle sm:mr-auto"
                onClick={() => {
                  if (!confirmDelete) return setConfirmDelete(true);
                  remove.mutate(goal.id, {
                    onSuccess: () => toast.success(`Goal “${goal.name}” deleted`),
                  });
                  onOpenChange(false);
                }}
              >
                <Trash2 /> {confirmDelete ? "Click again to delete" : "Delete"}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {goal ? "Save" : "Create goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
