"use client";

import type { TransactionDto } from "@ledgerly/shared";
import { FileUp, Plus, Receipt, SearchX, Tag, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCurrentHousehold } from "@/components/app-shell/household-context";
import { Page } from "@/components/app-shell/page";
import { Amount } from "@/components/money";
import { ErrorState, loadFailed } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts, useCategories } from "@/lib/query/hooks";
import {
  useBulkTransactions,
  useDeleteTransaction,
  usePendingTransactionIds,
  useTransactionList,
  useTransactionSummary,
} from "@/lib/query/transactions";
import { hasActiveFilters } from "@/lib/transactions/filters";
import { spring } from "@/lib/motion";
import { CategoryPicker } from "./category-picker";
import { FiltersBar, useTransactionFilters } from "./filters-bar";
import { TransactionList } from "./transaction-list";
import { TransactionSheet, type SheetMode } from "./transaction-sheet";

/** True when the user is typing somewhere — keyboard shortcuts must not fire then. */
function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(
    el?.closest(
      "input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox]",
    ),
  );
}

export function TransactionsView({ householdId }: { householdId: string }) {
  const household = useCurrentHousehold();
  const currency = household?.baseCurrency ?? "USD";
  const { state, apiFilter, update, clear } = useTransactionFilters();
  const accounts = useAccounts(householdId);
  const categories = useCategories(householdId);
  const list = useTransactionList(householdId, apiFilter);
  const summary = useTransactionSummary(householdId, apiFilter);
  const pendingIds = usePendingTransactionIds(householdId);
  const deleteTransaction = useDeleteTransaction(householdId);
  const bulk = useBulkTransactions(householdId);

  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data]);
  const [sheet, setSheet] = useState<{ open: boolean; mode: SheetMode }>({
    open: false,
    mode: { type: "create" },
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const openCreate = useCallback(() => setSheet({ open: true, mode: { type: "create" } }), []);
  const openEdit = useCallback(
    (transaction: TransactionDto) => setSheet({ open: true, mode: { type: "edit", transaction } }),
    [],
  );

  // ⌘K → "New transaction" lands here with ?new=1: open the sheet, then tidy the URL.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const wantsNew = searchParams.get("new") === "1";
  const [handledNew, setHandledNew] = useState(false);
  if (wantsNew !== handledNew) {
    setHandledNew(wantsNew);
    if (wantsNew) setSheet({ open: true, mode: { type: "create" } });
  }
  useEffect(() => {
    if (!wantsNew) return;
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("new");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [wantsNew, searchParams, router, pathname]);

  // A new filter means different rows: drop the selection and keyboard cursor.
  const filterKey = JSON.stringify(apiFilter);
  const [selectionFilterKey, setSelectionFilterKey] = useState(filterKey);
  if (filterKey !== selectionFilterKey) {
    setSelectionFilterKey(filterKey);
    setSelected(new Set());
    setActiveIndex(null);
  }

  /** Click toggles one row; Shift+click selects the whole range since the last click (like a file manager). */
  const toggleSelect = useCallback(
    (index: number, shiftKey: boolean) => {
      setSelected((current) => {
        const next = new Set(current);
        if (shiftKey && anchor !== null) {
          const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
          for (let i = from; i <= to; i++) if (rows[i]) next.add(rows[i]!.id);
        } else {
          const id = rows[index]!.id;
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        return next;
      });
      setAnchor(index);
    },
    [anchor, rows],
  );

  // ─── Keyboard shortcuts (Linear/Gmail style) ───────────────────────────────
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        sheet.open ||
        isTypingTarget(event.target)
      )
        return;
      const active = activeIndex !== null ? rows[activeIndex] : undefined;
      const move = (delta: number) => {
        event.preventDefault();
        setActiveIndex((i) => Math.max(0, Math.min(rows.length - 1, (i ?? -1) + delta)));
      };
      switch (event.key) {
        case "j":
        case "ArrowDown":
          return move(1);
        case "k":
        case "ArrowUp":
          return move(-1);
        case "n":
          event.preventDefault();
          return openCreate();
        case "/":
          event.preventDefault();
          return searchRef.current?.focus();
        case "Enter":
        case "e":
          if (active) {
            event.preventDefault();
            openEdit(active);
          }
          return;
        case "x":
          if (activeIndex !== null) {
            event.preventDefault();
            toggleSelect(activeIndex, event.shiftKey);
          }
          return;
        case "Delete":
        case "Backspace":
          if (active) {
            event.preventDefault();
            deleteTransaction(active);
          }
          return;
        case "Escape":
          setSelected(new Set());
          setActiveIndex(null);
          return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, activeIndex, sheet.open, openCreate, openEdit, toggleSelect, deleteTransaction]);

  async function runBulk(
    action: { action: "delete" } | { action: "categorize"; categoryId: string | null },
  ) {
    const ids = [...selected];
    const result = await bulk.mutateAsync({ ...action, ids });
    setSelected(new Set());
    toast.success(
      action.action === "delete"
        ? `Deleted ${result.affected} transaction${result.affected === 1 ? "" : "s"}`
        : `Categorised ${result.affected} transaction${result.affected === 1 ? "" : "s"}`,
      result.skipped
        ? { description: `${result.skipped} skipped (transfers can't have a category).` }
        : undefined,
    );
  }

  const filtered = hasActiveFilters(state);
  const s = summary.data;

  return (
    <Page
      title="Transactions"
      description={
        s ? (
          <span className="tabular-nums">
            {s.count.toLocaleString()} transaction{s.count === 1 ? "" : "s"}
            {s.incomeMinor > 0 && (
              <>
                {" "}
                · <Amount value={s.incomeMinor} currency={currency} className="!font-normal" /> in
              </>
            )}
            {s.spendingMinor > 0 && (
              <>
                {" "}
                · <Amount
                  value={-s.spendingMinor}
                  currency={currency}
                  className="!font-normal"
                />{" "}
                out
              </>
            )}
          </span>
        ) : (
          <Skeleton className="h-4 w-64" />
        )
      }
      actions={
        <>
          <Button asChild variant="outline">
            <Link href={`/app/${householdId}/imports`}>
              <FileUp /> Import CSV
            </Link>
          </Button>
          <Button onClick={openCreate}>
            <Plus /> New transaction{" "}
            <Kbd className="ml-1 border-white/20 bg-white/15 text-primary-foreground">N</Kbd>
          </Button>
        </>
      }
    >
      <div className="sticky top-[57px] z-30 -mx-4 bg-background/85 px-4 py-3 backdrop-blur-md sm:-mx-8 sm:px-8 lg:top-0">
        <FiltersBar
          ref={searchRef}
          state={state}
          update={update}
          clear={clear}
          accounts={accounts.data}
          categories={categories.data}
        />
      </div>

      <div
        className={list.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"}
      >
        {list.isPending ? (
          <div className="space-y-3 pt-6">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : loadFailed(list) ? (
          <ErrorState onRetry={list.refetch} className="mt-6" />
        ) : rows.length === 0 ? (
          <EmptyState filtered={filtered} onClear={clear} onCreate={openCreate} />
        ) : (
          <TransactionList
            rows={rows}
            accounts={accounts.data}
            categories={categories.data}
            pendingIds={pendingIds}
            selected={selected}
            onToggleSelect={toggleSelect}
            activeIndex={activeIndex}
            onActivate={setActiveIndex}
            onOpen={openEdit}
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            fetchNextPage={list.fetchNextPage}
            currency={currency}
          />
        )}
      </div>

      <p className="hidden pt-6 text-caption text-muted-foreground lg:block">
        Shortcuts: <Kbd>N</Kbd> new · <Kbd>/</Kbd> search · <Kbd>J</Kbd>/<Kbd>K</Kbd> move ·{" "}
        <Kbd>Enter</Kbd> edit · <Kbd>X</Kbd> select · <Kbd>⌫</Kbd> delete
      </p>

      {/* Bulk-action bar: slides up when anything is selected. */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={spring.smooth}
            className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-2 rounded-2xl border border-border bg-surface-raised p-2 pl-4 shadow-elevation-3"
            role="toolbar"
            aria-label="Bulk actions"
          >
            <span className="text-sm font-medium tabular-nums">{selected.size} selected</span>
            <CategoryPicker
              categories={categories.data}
              value={null}
              allowClear={false}
              onChange={(categoryId) => runBulk({ action: "categorize", categoryId })}
              trigger={
                <Button variant="outline" size="sm" loading={bulk.isPending}>
                  <Tag /> Categorise
                </Button>
              }
            />
            <Button
              variant="outline"
              size="sm"
              className="text-negative"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 /> Delete
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Clear selection"
              onClick={() => setSelected(new Set())}
            >
              <X />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk delete can't be "undone" the same way, so it asks first — the right tool for a bigger blast radius. */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selected.size} transactions?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone. Deleting half of a transfer deletes both halves.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={bulk.isPending}
              onClick={async () => {
                await runBulk({ action: "delete" });
                setConfirmDelete(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TransactionSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        mode={sheet.mode}
        householdId={householdId}
        accounts={accounts.data}
        categories={categories.data}
        onDelete={deleteTransaction}
      />
    </Page>
  );
}

function EmptyState({
  filtered,
  onClear,
  onCreate,
}: {
  filtered: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  const Icon = filtered ? SearchX : Receipt;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-3 py-20 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </span>
      <h2 className="text-title">{filtered ? "No transactions match" : "No transactions yet"}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {filtered
          ? "Try a different search, or clear the filters."
          : "Record your first expense or income to get started."}
      </p>
      {filtered ? (
        <Button variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      ) : (
        <Button onClick={onCreate}>
          <Plus /> Add a transaction
        </Button>
      )}
    </motion.div>
  );
}
