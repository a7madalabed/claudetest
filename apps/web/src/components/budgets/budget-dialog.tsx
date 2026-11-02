"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { currencyDecimals, parseMoney, type BudgetDto, type CategoryDto } from "@ledgerly/shared";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { CategoryPicker } from "@/components/transactions/category-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { formatMonthYear } from "@/lib/budgets";
import { currencySymbol, minorToInput } from "@/lib/money-input";
import { useCreateBudget, useDeleteBudget, useUpdateBudget } from "@/lib/query/budgets";

const FormSchema = z.object({
  categoryId: z.string({ error: "Choose a category" }).min(1, "Choose a category"),
  amount: z.string().trim().min(1, "Enter a monthly amount"),
  rollover: z.boolean(),
});
type FormValues = z.infer<typeof FormSchema>;

export function BudgetDialog({
  open,
  onOpenChange,
  householdId,
  budget,
  month,
  currency,
  categories,
  budgetedCategoryIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  /** null = create a new budget */
  budget: BudgetDto | null;
  /** The month on screen: new budgets start here, amount edits apply from here. */
  month: string;
  currency: string;
  categories: CategoryDto[] | undefined;
  budgetedCategoryIds: string[];
}) {
  const create = useCreateBudget(householdId);
  const update = useUpdateBudget(householdId);
  const remove = useDeleteBudget(householdId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Each opening starts un-armed. Adjusted DURING render (not in an effect) to avoid an extra pass.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setConfirmDelete(false);
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { categoryId: "", amount: "", rollover: false },
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    form.reset(
      budget
        ? {
            categoryId: budget.categoryId,
            amount: minorToInput(budget.amountMinor, currency),
            rollover: budget.rollover,
          }
        : { categoryId: "", amount: "", rollover: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when (re)opening
  }, [open, budget?.id]);

  // Hide categories that already have a budget (the API would answer 409).
  const available = categories?.filter(
    (c) => c.id === budget?.categoryId || !budgetedCategoryIds.includes(c.id),
  );

  const onSubmit = form.handleSubmit(async (values) => {
    const amountMinor = parseMoney(values.amount, currency);
    if (!amountMinor || amountMinor <= 0) {
      form.setError("amount", { message: "Enter an amount like 250.00" }, { shouldFocus: true });
      return;
    }
    try {
      if (budget) {
        await update.mutateAsync({
          id: budget.id,
          changes: {
            rollover: values.rollover,
            ...(amountMinor !== budget.amountMinor && { amountMinor, effectiveMonth: month }),
          },
        });
        toast.success("Budget updated");
      } else {
        const created = await create.mutateAsync({
          categoryId: values.categoryId,
          amountMinor,
          rollover: values.rollover,
          startMonth: month,
        });
        toast.success(`Budget added for ${created.name}`);
      }
      onOpenChange(false);
    } catch (error) {
      // Business-rule errors (409/422) belong next to the field they're about.
      if (isApiError(error) && (error.status === 409 || error.status === 422)) {
        form.setError("categoryId", { message: error.detail ?? error.title });
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
            <DialogTitle>{budget ? `Edit ${budget.name}` : "New budget"}</DialogTitle>
            <DialogDescription>
              {budget
                ? `A new amount applies from ${formatMonthYear(month)} onward. Earlier months keep theirs.`
                : `Set a monthly limit for a spending category, starting ${formatMonthYear(month)}.`}
            </DialogDescription>
          </DialogHeader>

          <Field label="Category" error={errors.categoryId?.message}>
            <Controller
              control={form.control}
              name="categoryId"
              render={({ field }) =>
                budget ? (
                  <Input value={budget.name} disabled readOnly />
                ) : (
                  <CategoryPicker
                    categories={available}
                    value={field.value || null}
                    onChange={(id) => field.onChange(id ?? "")}
                    kind="expense"
                    placeholder="Choose a category"
                    allowClear={false}
                  />
                )
              }
            />
          </Field>

          <Field
            label="Monthly amount"
            error={errors.amount?.message}
            description={budget?.rolloverMinor ? "Rollover is added on top of this." : undefined}
          >
            <Input
              {...form.register("amount")}
              inputMode="decimal"
              autoComplete="off"
              placeholder={currencyDecimals(currency) ? "0.00" : "0"}
              prefix={currencySymbol(currency)}
              autoFocus={!!budget}
              className="text-lg font-semibold tabular-nums"
            />
          </Field>

          <Controller
            control={form.control}
            name="rollover"
            render={({ field }) => (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-muted/50">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  className="mt-0.5"
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">Roll over leftovers</span>
                  <span className="text-caption text-muted-foreground">
                    Unspent money carries into next month — and an overspend is paid back from it.
                  </span>
                </span>
              </label>
            )}
          />

          <DialogFooter className="items-center">
            {budget && (
              <Button
                type="button"
                variant="ghost"
                className="text-negative hover:bg-negative-subtle sm:mr-auto"
                disabled={remove.isPending}
                onClick={() => {
                  // Two-step delete: deleting a budget also deletes its history.
                  if (!confirmDelete) return setConfirmDelete(true);
                  remove.mutate(budget.id, {
                    onSuccess: () => toast.success(`Budget for ${budget.name} deleted`),
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
              {budget ? "Save" : "Add budget"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
