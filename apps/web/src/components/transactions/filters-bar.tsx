"use client";

import type { AccountDto, CategoryDto } from "@ledgerly/shared";
import { ChevronDown, Search, Tag, X } from "lucide-react";
import { motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { forwardRef, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectItem } from "@/components/ui/select";
import { spring } from "@/lib/motion";
import {
  RANGE_PRESETS,
  filterParams,
  hasActiveFilters,
  parseFilterParams,
  toApiFilter,
  type FilterState,
  type RangePreset,
} from "@/lib/transactions/filters";
import { cn } from "@/lib/utils";
import { CategoryPicker } from "./category-picker";

/** Filter state that lives in the URL. `replace` (not push): filtering shouldn't flood the back button. */
export function useTransactionFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = useMemo(
    () => parseFilterParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const apiFilter = useMemo(() => toApiFilter(state), [state]);

  const update = (patch: Partial<FilterState>) => {
    const query = filterParams({ ...state, ...patch }).toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  return { state, apiFilter, update, clear: () => router.replace(pathname, { scroll: false }) };
}

const TYPES = [
  { value: undefined, label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfers" },
] as const;

export const FiltersBar = forwardRef<
  HTMLInputElement,
  {
    state: FilterState;
    update: (patch: Partial<FilterState>) => void;
    clear: () => void;
    accounts: AccountDto[] | undefined;
    categories: CategoryDto[] | undefined;
  }
>(function FiltersBar({ state, update, clear, accounts, categories }, searchRef) {
  // The search box updates the URL 250 ms after typing stops ("debouncing"), so
  // we don't fire a request — and a history entry — for every keystroke.
  const [search, setSearch] = useState(state.q ?? "");
  // When the URL changes from OUTSIDE the box (Clear, back button), follow it.
  // Adjusting state during render — instead of in an effect — avoids an extra
  // render with stale text (React's recommended pattern for "derived" resets).
  const [syncedQ, setSyncedQ] = useState(state.q);
  if (state.q !== syncedQ) {
    setSyncedQ(state.q);
    if ((state.q ?? "") !== search.trim()) setSearch(state.q ?? "");
  }
  useEffect(() => {
    if ((state.q ?? "") === search.trim()) return;
    const timer = setTimeout(() => update({ q: search.trim() || undefined }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on `search` only
  }, [search]);

  const category = categories?.find((c) => c.id === state.categoryId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (e.currentTarget as HTMLInputElement).blur()}
          placeholder="Search transactions"
          aria-label="Search transactions"
          className="h-10 w-full rounded-lg border border-input bg-surface pr-10 pl-9 text-sm shadow-elevation-1 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20"
        />
        <Kbd className="absolute top-1/2 right-2.5 -translate-y-1/2">/</Kbd>
      </div>

      <div role="radiogroup" aria-label="Type" className="flex rounded-lg bg-muted p-1">
        {TYPES.map(({ value, label }) => {
          const active = state.type === value;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => update({ type: value })}
              className={cn(
                "relative rounded-md px-3 py-1 text-sm font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="type-filter-pill"
                  transition={spring.snappy}
                  className="absolute inset-0 rounded-md bg-surface shadow-elevation-1"
                />
              )}
              <span className="relative">{label}</span>
            </button>
          );
        })}
      </div>

      <Select
        value={state.accountId ?? "all"}
        onValueChange={(v) => update({ accountId: v === "all" ? undefined : v })}
        aria-label="Account"
        className="w-auto min-w-40"
      >
        <SelectItem value="all">All accounts</SelectItem>
        {accounts?.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </Select>

      <CategoryPicker
        categories={categories}
        value={state.categoryId}
        onChange={(id) => update({ categoryId: id ?? undefined })}
        trigger={
          <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-lg border border-input bg-surface px-3 text-sm shadow-elevation-1"
          >
            <Tag className="size-4 text-muted-foreground" />
            <span className={cn(!category && "text-muted-foreground")}>
              {category?.name ?? "Category"}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        }
      />

      <Select
        value={state.range}
        onValueChange={(v) => update({ range: v as RangePreset })}
        aria-label="Date range"
        className="w-auto min-w-36"
      >
        {Object.entries(RANGE_PRESETS).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </Select>

      {hasActiveFilters(state) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch("");
            clear();
          }}
        >
          <X /> Clear
        </Button>
      )}
    </div>
  );
});
