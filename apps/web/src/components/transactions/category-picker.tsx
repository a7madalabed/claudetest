"use client";

import type { CategoryDto } from "@ledgerly/shared";
import { Command } from "cmdk";
import { Check, ChevronDown, Tag, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CategoryIcon } from "@/lib/category-icons";
import { cn } from "@/lib/utils";

/**
 * A searchable category picker (a "combobox"): type "cof" to find Food › Coffee.
 * With 20+ categories, a search box beats scrolling a long dropdown. Categories
 * are grouped under their parent, filtered by kind (income vs expense).
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  kind,
  id,
  trigger,
  placeholder = "Uncategorised",
  allowClear = true,
}: {
  categories: CategoryDto[] | undefined;
  value: string | null | undefined;
  onChange: (categoryId: string | null) => void;
  kind?: "income" | "expense";
  id?: string;
  trigger?: ReactNode;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const visible = (categories ?? []).filter((c) => !c.archived && (!kind || c.kind === kind));
    return visible
      .filter((c) => c.parentId === null)
      .map((parent) => ({ parent, children: visible.filter((c) => c.parentId === parent.id) }));
  }, [categories, kind]);
  const selected = categories?.find((c) => c.id === value);
  const parentOfSelected = selected?.parentId
    ? categories?.find((c) => c.id === selected.parentId)
    : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            id={id}
            type="button"
            className="flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-surface px-3 text-left text-sm shadow-elevation-1 outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20"
          >
            {selected ? (
              <CategoryIcon
                name={(parentOfSelected ?? selected).icon}
                className="size-4 text-muted-foreground"
              />
            ) : (
              <Tag className="size-4 text-muted-foreground" />
            )}
            <span className={cn("flex-1 truncate", !selected && "text-muted-foreground")}>
              {selected
                ? parentOfSelected
                  ? `${parentOfSelected.name} › ${selected.name}`
                  : selected.name
                : placeholder}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command loop>
          <Command.Input
            autoFocus
            placeholder="Search categories…"
            className="h-11 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-72 overflow-y-auto p-1">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No category found.
            </Command.Empty>
            {allowClear && value && (
              <Item
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
                icon={<X className="size-4" />}
              >
                Clear category
              </Item>
            )}
            {groups.map(({ parent, children }) => {
              return (
                <Command.Group key={parent.id}>
                  <Item
                    value={parent.name}
                    selected={value === parent.id}
                    onSelect={() => {
                      onChange(parent.id);
                      setOpen(false);
                    }}
                    icon={<CategoryIcon name={parent.icon} className="size-4" />}
                  >
                    {parent.name}
                  </Item>
                  {children.map((child) => (
                    <Item
                      key={child.id}
                      value={`${parent.name} ${child.name}`}
                      selected={value === child.id}
                      onSelect={() => {
                        onChange(child.id);
                        setOpen(false);
                      }}
                      indent
                    >
                      {child.name}
                    </Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Item({
  children,
  onSelect,
  icon,
  selected,
  indent,
  value,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  selected?: boolean;
  indent?: boolean;
  value?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm select-none data-[selected=true]:bg-muted [&_svg]:text-muted-foreground",
        indent && "pl-9",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {selected && <Check className="size-4 !text-primary" />}
    </Command.Item>
  );
}
