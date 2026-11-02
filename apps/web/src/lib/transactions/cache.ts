import type { TransactionDto, TransactionFilter, TransactionPage } from "@ledgerly/shared";
import type { InfiniteData } from "@tanstack/react-query";

/*
 * Pure helpers for OPTIMISTIC UPDATES: editing the cached pages of an infinite
 * list so a change appears instantly, before the server confirms it. They're
 * pure functions (data in → new data out, nothing mutated) so they're easy to
 * test and safe to use with React's immutable state model.
 */

export type Pages = InfiniteData<TransactionPage, string | null>;

/** The list's sort order: newest date first, then newest id (UUID v7 sorts by time). */
export function compareTransactions(
  a: Pick<TransactionDto, "occurredOn" | "id">,
  b: Pick<TransactionDto, "occurredOn" | "id">,
) {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Would the server include this transaction in a list with these filters?
 * Mirrors the API's filter logic, so an optimistic row only appears in lists
 * where it really belongs (a new expense doesn't pop into an "Income" view).
 * `parentOf` maps a category to its parent, for "Food" ⊃ "Groceries".
 */
export function matchesFilter(
  t: TransactionDto,
  filter: TransactionFilter,
  parentOf: (categoryId: string) => string | null | undefined = () => null,
): boolean {
  if (filter.accountId && t.accountId !== filter.accountId) return false;
  if (
    filter.categoryId &&
    t.categoryId !== filter.categoryId &&
    (!t.categoryId || parentOf(t.categoryId) !== filter.categoryId)
  )
    return false;
  if (filter.from && t.occurredOn < filter.from) return false;
  if (filter.to && t.occurredOn >= filter.to) return false;
  if (filter.type === "income" && !(t.amountMinor > 0 && !t.transferId)) return false;
  if (filter.type === "expense" && !(t.amountMinor < 0 && !t.transferId)) return false;
  if (filter.type === "transfer" && !t.transferId) return false;
  if (filter.q && !t.description.toLowerCase().includes(filter.q.toLowerCase())) return false;
  return true;
}

/**
 * Inserts a row at its sorted position. If it sorts AFTER everything loaded so
 * far and more pages exist, it belongs to a page we haven't fetched yet — so we
 * leave it out rather than show it in the wrong place.
 */
export function insertSorted(data: Pages, t: TransactionDto): Pages {
  const pages = data.pages.map((page) => ({ ...page, data: [...page.data] }));
  for (const [index, page] of pages.entries()) {
    const position = page.data.findIndex((row) => compareTransactions(t, row) < 0);
    if (position !== -1) {
      page.data.splice(position, 0, t);
      return { ...data, pages };
    }
    const isLastLoaded = index === pages.length - 1;
    if (isLastLoaded && page.nextCursor === null) {
      page.data.push(t);
      return { ...data, pages };
    }
  }
  if (pages.length === 0)
    return { ...data, pages: [{ data: [t], nextCursor: null }], pageParams: [null] };
  return data;
}

export function removeWhere(data: Pages, predicate: (t: TransactionDto) => boolean): Pages {
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, data: page.data.filter((t) => !predicate(t)) })),
  };
}

/** Replaces a row; if the change moves it (new date) or it no longer matches the filter, re-place or drop it. */
export function replaceTransaction(
  data: Pages,
  updated: TransactionDto,
  stillMatches: boolean,
): Pages {
  const without = removeWhere(data, (t) => t.id === updated.id);
  return stillMatches ? insertSorted(without, updated) : without;
}

export interface DayGroup {
  date: string;
  /** Net of non-transfer rows that day. */
  totalMinor: number;
  rows: TransactionDto[];
}

/** Groups an already-sorted list by day, for the date headers in the list. */
export function groupByDay(rows: TransactionDto[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    let group = groups.at(-1);
    if (!group || group.date !== row.occurredOn) {
      group = { date: row.occurredOn, totalMinor: 0, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
    if (!row.transferId) group.totalMinor += row.amountMinor;
  }
  return groups;
}
