"use client";

import type { AccountDto, CategoryDto, TransactionDto } from "@ledgerly/shared";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Amount } from "@/components/money";
import { Checkbox } from "@/components/ui/checkbox";
import { CategoryIcon } from "@/lib/category-icons";
import { groupByDay, type DayGroup } from "@/lib/transactions/cache";
import { cn } from "@/lib/utils";

type Item =
  | { kind: "header"; key: string; group: DayGroup }
  | { kind: "row"; key: string; row: TransactionDto; rowIndex: number };

const headerFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const yearFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (date === today) return "Today";
  return (d.getUTCFullYear() === now.getFullYear() ? headerFormat : yearFormat).format(d);
}

/**
 * The transactions list — VIRTUALISED: however many thousands of rows are loaded,
 * only the ~20 visible on screen (plus a few above/below) exist in the DOM. The
 * rest are just empty space of the right height. That keeps scrolling at 60 fps
 * and memory flat, where rendering 5,000 real rows would freeze the page.
 */
export function TransactionList({
  rows,
  accounts,
  categories,
  pendingIds,
  selected,
  onToggleSelect,
  activeIndex,
  onActivate,
  onOpen,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  currency,
}: {
  rows: TransactionDto[];
  accounts: AccountDto[] | undefined;
  categories: CategoryDto[] | undefined;
  pendingIds: Set<string>;
  selected: Set<string>;
  onToggleSelect: (rowIndex: number, shiftKey: boolean) => void;
  activeIndex: number | null;
  onActivate: (rowIndex: number) => void;
  onOpen: (row: TransactionDto) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  currency: string;
}) {
  const items = useMemo<Item[]>(() => {
    let rowIndex = 0;
    return groupByDay(rows).flatMap((group) => [
      { kind: "header" as const, key: `h-${group.date}`, group },
      ...group.rows.map((row) => ({
        kind: "row" as const,
        key: row.id,
        row,
        rowIndex: rowIndex++,
      })),
    ]);
  }, [rows]);

  const categoryById = useMemo(() => new Map(categories?.map((c) => [c.id, c])), [categories]);
  const accountById = useMemo(() => new Map(accounts?.map((a) => [a.id, a])), [accounts]);

  // The list starts below the header and filters; the virtualizer needs that offset.
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => setScrollMargin(listRef.current?.offsetTop ?? 0), []);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: (index) => (items[index]?.kind === "header" ? 44 : 60),
    overscan: 10,
    scrollMargin,
    getItemKey: (index) => items[index]!.key,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Infinite scroll: when the last rendered item is near the end, fetch the next page.
  const lastIndex = virtualItems.at(-1)?.index ?? 0;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastIndex >= items.length - 15) fetchNextPage();
  }, [lastIndex, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Keep the keyboard-active row on screen.
  useEffect(() => {
    if (activeIndex === null) return;
    const itemIndex = items.findIndex(
      (item) => item.kind === "row" && item.rowIndex === activeIndex,
    );
    if (itemIndex >= 0) virtualizer.scrollToIndex(itemIndex, { align: "auto" });
  }, [activeIndex, items, virtualizer]);

  return (
    <div ref={listRef}>
      <ul
        role="list"
        aria-label="Transactions"
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtual) => {
          const item = items[virtual.index]!;
          return (
            <li
              key={virtual.key}
              data-index={virtual.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{
                transform: `translateY(${virtual.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              {item.kind === "header" ? (
                <div className="flex items-end justify-between px-3 pt-5 pb-2 text-caption font-medium text-muted-foreground">
                  <span>{dayLabel(item.group.date)}</span>
                  {item.group.totalMinor !== 0 && (
                    <Amount
                      value={item.group.totalMinor}
                      currency={currency}
                      className="!font-normal"
                    />
                  )}
                </div>
              ) : (
                <Row
                  row={item.row}
                  category={item.row.categoryId ? categoryById.get(item.row.categoryId) : undefined}
                  parent={(() => {
                    const c = item.row.categoryId
                      ? categoryById.get(item.row.categoryId)
                      : undefined;
                    return c?.parentId ? categoryById.get(c.parentId) : c;
                  })()}
                  account={accountById.get(item.row.accountId)}
                  pending={pendingIds.has(item.row.id)}
                  selected={selected.has(item.row.id)}
                  selectionMode={selected.size > 0}
                  active={activeIndex === item.rowIndex}
                  onToggleSelect={(shift) => onToggleSelect(item.rowIndex, shift)}
                  onOpen={() => {
                    onActivate(item.rowIndex);
                    onOpen(item.row);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {isFetchingNextPage && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading more…
        </div>
      )}
      {!hasNextPage && rows.length > 30 && (
        <p className="py-8 text-center text-caption text-muted-foreground">
          That&apos;s everything.
        </p>
      )}
    </div>
  );
}

function Row({
  row,
  category,
  parent,
  account,
  pending,
  selected,
  selectionMode,
  active,
  onToggleSelect,
  onOpen,
}: {
  row: TransactionDto;
  category: CategoryDto | undefined;
  parent: CategoryDto | undefined;
  account: AccountDto | undefined;
  pending: boolean;
  selected: boolean;
  selectionMode: boolean;
  active: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <div
      data-active={active || undefined}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
        selected ? "bg-primary-subtle" : "hover:bg-muted/60",
        active && "ring-2 ring-ring/40",
        pending && "animate-rise",
      )}
    >
      {/* The checkbox appears on hover, on keyboard focus, or once you're selecting. */}
      <div
        className={cn(
          "flex w-5 justify-center",
          !selectionMode &&
            !selected &&
            "opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100",
        )}
      >
        <Checkbox
          checked={selected}
          aria-label={`Select ${row.description}`}
          onClick={(event) => {
            event.preventDefault();
            onToggleSelect(event.shiftKey);
          }}
        />
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {row.transferId ? (
            <ArrowLeftRight className="size-4" />
          ) : (
            <CategoryIcon name={parent?.icon} className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{row.description}</span>
          <span className="block truncate text-caption text-muted-foreground">
            {row.transferId
              ? "Transfer"
              : category
                ? parent && parent.id !== category.id
                  ? `${parent.name} › ${category.name}`
                  : category.name
                : "Uncategorised"}
            <span className="hidden sm:inline"> · {account?.name ?? "…"}</span>
          </span>
        </span>
        {pending && (
          <span className="flex items-center gap-1 text-caption text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Saving
          </span>
        )}
        <Amount
          value={row.amountMinor}
          currency={account?.currency ?? "USD"}
          className={cn("text-sm", row.transferId && "!text-muted-foreground")}
        />
      </button>
    </div>
  );
}
