"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { CategoryDto } from "@ledgerly/shared";
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
import { useCreateCategory, useDeleteCategory, useUpdateCategory } from "@/lib/query/categories";

/** Radix Select can't use "" as a value: this stands for "no parent". */
const TOP_LEVEL = "top-level";

const FormSchema = z.object({
  name: z.string().trim().min(1, "Give the category a name").max(50, "Use at most 50 characters"),
  kind: z.enum(["expense", "income"]),
  parentId: z.string(),
});
type FormValues = z.infer<typeof FormSchema>;

export function CategoryDialog({
  open,
  onOpenChange,
  householdId,
  category,
  categories,
  defaultKind = "expense",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  /** null = create a new one. */
  category: CategoryDto | null;
  categories: CategoryDto[];
  defaultKind?: CategoryDto["kind"];
}) {
  const create = useCreateCategory(householdId);
  const update = useUpdateCategory(householdId);
  const remove = useDeleteCategory(householdId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setConfirmDelete(false);
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: "", kind: defaultKind, parentId: TOP_LEVEL },
  });
  const { errors, isSubmitting } = form.formState;
  const kind = useWatch({ control: form.control, name: "kind" });
  // Categories nest one level: a parent must be top-level, of the same kind, and in use.
  const parents = categories.filter((c) => c.parentId === null && c.kind === kind && !c.archived);

  useEffect(() => {
    if (!open) return;
    form.reset(
      category
        ? { name: category.name, kind: category.kind, parentId: category.parentId ?? TOP_LEVEL }
        : { name: "", kind: defaultKind, parentId: TOP_LEVEL },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when (re)opening
  }, [open, category?.id]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (category) {
        await update.mutateAsync({ id: category.id, changes: { name: values.name } });
        toast.success("Category renamed");
      } else {
        await create.mutateAsync({
          name: values.name,
          kind: values.kind,
          parentId: values.parentId === TOP_LEVEL ? null : values.parentId,
          icon: null,
          sortOrder: 0,
        });
        toast.success(`Category “${values.name}” added`);
      }
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error) && error.code === "category_name_taken") {
        form.setError("name", { message: error.detail ?? error.title }, { shouldFocus: true });
      } else {
        toast.error(errorMessage(error));
      }
    }
  });

  const setArchived = async (archived: boolean) => {
    if (!category) return;
    try {
      await update.mutateAsync({ id: category.id, changes: { archived } });
      toast.success(archived ? `“${category.name}” archived` : `“${category.name}” is back`);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const onDelete = async () => {
    if (!category) return;
    if (!confirmDelete) return setConfirmDelete(true);
    try {
      await remove.mutateAsync(category.id);
      toast.success(`“${category.name}” deleted`);
      onOpenChange(false);
    } catch (error) {
      // In use (transactions, subcategories, a budget): the API says to archive instead.
      toast.error(errorMessage(error));
      setConfirmDelete(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription>
              {category
                ? "Renaming keeps every transaction in it. Archive it to hide it from new transactions, without touching the old ones."
                : "Group what you spend or earn, e.g. “Childcare” or “Side income”. A subcategory’s spending also counts toward its parent."}
            </DialogDescription>
          </DialogHeader>

          <Field label="Name" error={errors.name?.message}>
            <Input {...form.register("name")} placeholder="e.g. Childcare" autoFocus />
          </Field>

          {!category && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kind">
                <Controller
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        form.setValue("parentId", TOP_LEVEL); // parents differ per kind
                      }}
                      aria-label="Kind"
                    >
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="income">Income</SelectItem>
                    </Select>
                  )}
                />
              </Field>
              <Field label="Inside">
                <Controller
                  control={form.control}
                  name="parentId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} aria-label="Inside">
                      <SelectItem value={TOP_LEVEL}>Nothing (top level)</SelectItem>
                      {parents.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </Select>
                  )}
                />
              </Field>
            </div>
          )}

          <DialogFooter className="items-center">
            {category && (
              <div className="flex gap-1 sm:mr-auto">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setArchived(!category.archived)}
                >
                  {category.archived ? <ArchiveRestore /> : <Archive />}
                  {category.archived ? "Unarchive" : "Archive"}
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
              {category ? "Save" : "Add category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
