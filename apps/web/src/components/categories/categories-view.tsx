"use client";

import type { CategoryDto } from "@ledgerly/shared";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useCurrentHousehold } from "@/components/app-shell/household-context";
import { Page } from "@/components/app-shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, loadFailed } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryIcon } from "@/lib/category-icons";
import { useCategories } from "@/lib/query/hooks";
import { useNewParam } from "@/lib/use-new-param";
import { cn } from "@/lib/utils";
import { CategoryDialog } from "./category-dialog";

type DialogState =
  { open: false } | { open: true; category: CategoryDto | null; kind: CategoryDto["kind"] };

const KINDS: Array<{ kind: CategoryDto["kind"]; label: string }> = [
  { kind: "expense", label: "Spending" },
  { kind: "income", label: "Income" },
];

const byOrderThenName = (a: CategoryDto, b: CategoryDto) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * The household's categories (Stage 17): until now they could only be changed
 * through the API. Two levels, as the API allows: "Food" → "Groceries".
 */
export function CategoriesView({ householdId }: { householdId: string }) {
  const household = useCurrentHousehold();
  const canEdit = household !== undefined && household.role !== "viewer";
  const query = useCategories(householdId);
  const { data: categories, isPending } = query;
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  useNewParam(() => canEdit && setDialog({ open: true, category: null, kind: "expense" }));

  const add = (kind: CategoryDto["kind"]) => setDialog({ open: true, category: null, kind });
  const edit = canEdit
    ? (category: CategoryDto) => setDialog({ open: true, category, kind: category.kind })
    : undefined;

  return (
    <Page
      title="Categories"
      description="How transactions are grouped in budgets and reports."
      actions={
        canEdit && (
          <Button onClick={() => add("expense")}>
            <Plus /> New category
          </Button>
        )
      }
    >
      {isPending ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-80 rounded-2xl" />
          ))}
        </div>
      ) : loadFailed(query) ? (
        <ErrorState onRetry={query.refetch} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {KINDS.map(({ kind, label }) => {
            const all = (categories ?? []).filter((c) => c.kind === kind);
            const tops = all.filter((c) => c.parentId === null).sort(byOrderThenName);
            const headingId = `categories-${kind}`;
            return (
              <section key={kind} aria-labelledby={headingId}>
                <Card className="p-0">
                  <div className="flex items-center justify-between border-b border-border px-5 py-4">
                    <h2 id={headingId} className="font-semibold">
                      {label}
                    </h2>
                    {canEdit && (
                      <Button variant="ghost" size="sm" onClick={() => add(kind)}>
                        <Plus /> Add
                      </Button>
                    )}
                  </div>
                  {tops.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                      No {label.toLowerCase()} categories yet.
                    </p>
                  ) : (
                    <ul className="py-2" aria-label={`${label} categories`}>
                      {tops.map((top) => (
                        <li key={top.id}>
                          <CategoryRow category={top} icon={top.icon} onEdit={edit} />
                          <ul aria-label={`Inside ${top.name}`}>
                            {all
                              .filter((c) => c.parentId === top.id)
                              .sort(byOrderThenName)
                              .map((child) => (
                                <li key={child.id}>
                                  {/* Subcategories show their parent's icon, as everywhere else. */}
                                  <CategoryRow
                                    category={child}
                                    icon={child.icon ?? top.icon}
                                    onEdit={edit}
                                    nested
                                  />
                                </li>
                              ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </section>
            );
          })}
        </div>
      )}

      <CategoryDialog
        open={dialog.open}
        onOpenChange={(open) => !open && setDialog({ open: false })}
        householdId={householdId}
        category={dialog.open ? dialog.category : null}
        categories={categories ?? []}
        defaultKind={dialog.open ? dialog.kind : "expense"}
      />
    </Page>
  );
}

function CategoryRow({
  category,
  icon,
  onEdit,
  nested = false,
}: {
  category: CategoryDto;
  icon: string | null;
  onEdit?: (category: CategoryDto) => void;
  nested?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-5 py-2",
        nested && "pl-14",
        category.archived && "opacity-60",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
          nested ? "size-7" : "size-9",
        )}
      >
        <CategoryIcon name={icon} className={nested ? "size-3.5" : "size-4"} />
      </span>
      <span className={cn("min-w-0 flex-1 truncate", !nested && "font-medium")}>
        {category.name}
      </span>
      {category.archived && <Badge tone="neutral">Archived</Badge>}
      {onEdit && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(category)}
          aria-label={`Edit ${category.name}`}
        >
          <Pencil />
        </Button>
      )}
    </div>
  );
}
