"use client";

import {
  BulkTransactionResultSchema,
  TransactionPageSchema,
  TransactionSchema,
  TransactionSummarySchema,
  TransferSchema,
  type BulkTransactionAction,
  type CategoryDto,
  type CreateTransactionInput,
  type CreateTransferInput,
  type TransactionDto,
  type TransactionFilter,
  type UpdateTransactionInput,
} from "@ledgerly/shared";
import {
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { v7 as uuidv7 } from "uuid";
import { api } from "../api/client";
import { errorMessage, isApiError } from "../api/errors";
import {
  insertSorted,
  matchesFilter,
  removeWhere,
  replaceTransaction,
  type Pages,
} from "../transactions/cache";

// ─── Keys ────────────────────────────────────────────────────────────────────

const listPrefix = (householdId: string) =>
  ["households", householdId, "transactions", "list"] as const;
const listKey = (householdId: string, filter: TransactionFilter) =>
  [...listPrefix(householdId), filter] as const;
const summaryKey = (householdId: string, filter: TransactionFilter) =>
  ["households", householdId, "transactions", "summary", filter] as const;

function toQueryString(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null) search.set(key, String(value));
  return search.toString();
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * Infinite, cursor-paginated list (Stage 4's keyset pagination). Each page's
 * `nextCursor` is the parameter for the next one; `null` means "the end".
 */
export function useTransactionList(householdId: string, filter: TransactionFilter) {
  return useInfiniteQuery({
    queryKey: listKey(householdId, filter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api(
        `/v1/households/${householdId}/transactions?${toQueryString({ ...filter, limit: 50, cursor: pageParam })}`,
        {
          schema: TransactionPageSchema,
          signal,
        },
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // While a new filter loads, keep showing the previous results (dimmed) instead
    // of flashing an empty skeleton on every keystroke in the search box.
    placeholderData: (previous) => previous,
  });
}

export function useTransactionSummary(householdId: string, filter: TransactionFilter) {
  return useQuery({
    queryKey: summaryKey(householdId, filter),
    queryFn: ({ signal }) =>
      api(`/v1/households/${householdId}/transactions/summary?${toQueryString(filter)}`, {
        schema: TransactionSummarySchema,
        signal,
      }),
    placeholderData: (previous) => previous,
  });
}

// ─── Optimistic cache editing ────────────────────────────────────────────────

/** Applies `edit` to every cached transaction list of this household, respecting each list's filter. */
function editLists(
  queryClient: QueryClient,
  householdId: string,
  edit: (data: Pages, filter: TransactionFilter) => Pages,
) {
  for (const [key, data] of queryClient.getQueriesData<Pages>({
    queryKey: listPrefix(householdId),
  })) {
    if (!data) continue;
    queryClient.setQueryData(key, edit(data, key[4] as TransactionFilter));
  }
}

/** Saves every list so a failed mutation can put things back exactly as they were. */
function snapshotLists(queryClient: QueryClient, householdId: string) {
  return queryClient.getQueriesData<Pages>({ queryKey: listPrefix(householdId) });
}
function restoreLists(queryClient: QueryClient, snapshot: ReturnType<typeof snapshotLists>) {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}

/** After any change: refetch lists, summaries, balances and reports for the household. */
const refreshHousehold = (queryClient: QueryClient, householdId: string) => {
  // A change may trigger a budget alert a few seconds later (a background job,
  // debounced by 2 s): check notifications then, instead of waiting for the poll.
  setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["notifications"] }), 4_000);
  return queryClient.invalidateQueries({ queryKey: ["households", householdId] });
};

function useParentOf(categories: CategoryDto[] | undefined) {
  return useMemo(() => {
    const parents = new Map(categories?.map((c) => [c.id, c.parentId]));
    return (id: string) => parents.get(id) ?? null;
  }, [categories]);
}

// ─── Create (optimistic) ─────────────────────────────────────────────────────

/**
 * Creating a transaction feels instant:
 *  1. The CLIENT generates the id (UUID v7), so the optimistic row already has
 *     its final identity — no "temp id" to swap later.
 *  2. onMutate inserts it into every cached list where it belongs.
 *  3. The request carries `Idempotency-Key: <id>`, so retrying after a network
 *     blip can never create a duplicate (Stage 4 §8) — which is exactly what
 *     makes automatic retries safe here.
 *  4. On error: put the lists back and tell the user. On success or error:
 *     refetch to reconcile with the server's truth.
 */
export function useCreateTransaction(householdId: string, categories?: CategoryDto[]) {
  const queryClient = useQueryClient();
  const parentOf = useParentOf(categories);

  return useMutation({
    mutationKey: ["createTransaction", householdId],
    meta: { handlesErrors: true },
    retry: (count, error) => !isApiError(error) && count < 3, // only network failures, and only because it's idempotent
    mutationFn: (input: CreateTransactionInput & { id: string }) =>
      api(`/v1/households/${householdId}/transactions`, {
        method: "POST",
        body: input,
        schema: TransactionSchema,
        headers: { "idempotency-key": input.id },
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: listPrefix(householdId) });
      const snapshot = snapshotLists(queryClient, householdId);
      const now = new Date().toISOString();
      const optimistic: TransactionDto = {
        id: input.id,
        accountId: input.accountId,
        categoryId: input.categoryId ?? null,
        amountMinor: input.amountMinor,
        occurredOn: input.occurredOn,
        description: input.description,
        notes: input.notes ?? null,
        transferId: null,
        createdAt: now,
        updatedAt: now,
      };
      editLists(queryClient, householdId, (data, filter) =>
        matchesFilter(optimistic, filter, parentOf) ? insertSorted(data, optimistic) : data,
      );
      return { snapshot };
    },
    onError: (error, _input, context) => {
      if (context) restoreLists(queryClient, context.snapshot);
      toast.error("Couldn't save the transaction", { description: errorMessage(error) });
    },
    onSettled: () => refreshHousehold(queryClient, householdId),
  });
}

export const newTransactionId = () => uuidv7();

/** Ids of creates still in flight — the list shows those rows as "saving". */
export function usePendingTransactionIds(householdId: string) {
  const ids = useMutationState({
    filters: { mutationKey: ["createTransaction", householdId], status: "pending" },
    select: (mutation) => (mutation.state.variables as { id: string }).id,
  });
  return useMemo(() => new Set(ids), [ids]);
}

// ─── Update (optimistic) ─────────────────────────────────────────────────────

export function useUpdateTransaction(householdId: string, categories?: CategoryDto[]) {
  const queryClient = useQueryClient();
  const parentOf = useParentOf(categories);

  return useMutation({
    meta: { handlesErrors: true },
    mutationFn: ({
      id,
      changes,
    }: {
      id: string;
      changes: UpdateTransactionInput;
      previous: TransactionDto;
    }) =>
      api(`/v1/households/${householdId}/transactions/${id}`, {
        method: "PATCH",
        body: changes,
        schema: TransactionSchema,
      }),
    onMutate: async ({ changes, previous }) => {
      await queryClient.cancelQueries({ queryKey: listPrefix(householdId) });
      const snapshot = snapshotLists(queryClient, householdId);
      const updated: TransactionDto = {
        ...previous,
        ...changes,
        updatedAt: new Date().toISOString(),
      };
      editLists(queryClient, householdId, (data, filter) =>
        replaceTransaction(data, updated, matchesFilter(updated, filter, parentOf)),
      );
      return { snapshot };
    },
    onError: (error, _vars, context) => {
      if (context) restoreLists(queryClient, context.snapshot);
      toast.error("Couldn't save your changes", { description: errorMessage(error) });
    },
    onSettled: () => refreshHousehold(queryClient, householdId),
  });
}

// ─── Delete with undo ────────────────────────────────────────────────────────

/**
 * Deletes are OPTIMISTIC and DEFERRED: the row disappears immediately and a
 * toast offers "Undo" for 5 seconds; only then is the DELETE request sent.
 * Undo simply restores the cache — the server never knew. This is the pattern
 * Gmail made famous ("Undo send") and it beats "Are you sure?" dialogs: no
 * interruption for the 99% of deletes you meant, a safety net for the 1%.
 */
const UNDO_MS = 5_000;
const pendingDeletes = new Map<string, () => void>();

/** If the tab closes during the undo window, send the pending deletes anyway. */
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const flush of pendingDeletes.values()) flush();
  });
}

export function useDeleteTransaction(householdId: string) {
  const queryClient = useQueryClient();

  return (transaction: TransactionDto) => {
    const snapshot = snapshotLists(queryClient, householdId);
    const isPair = (t: TransactionDto) =>
      t.id === transaction.id ||
      (transaction.transferId !== null && t.transferId === transaction.transferId);
    editLists(queryClient, householdId, (data) => removeWhere(data, isPair));

    const url = `/api/v1/households/${householdId}/transactions/${transaction.id}`;
    const send = () => {
      pendingDeletes.delete(transaction.id);
      // keepalive lets the request finish even if the page is being unloaded.
      fetch(url, { method: "DELETE", credentials: "same-origin", keepalive: true })
        .then((response) => {
          if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
        })
        .catch(() => {
          restoreLists(queryClient, snapshot);
          toast.error("Couldn't delete the transaction");
        })
        .finally(() => refreshHousehold(queryClient, householdId));
    };
    const timer = setTimeout(send, UNDO_MS);
    pendingDeletes.set(transaction.id, () => {
      clearTimeout(timer);
      send();
    });

    toast(transaction.transferId ? "Transfer deleted" : "Transaction deleted", {
      description: transaction.description,
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(timer);
          pendingDeletes.delete(transaction.id);
          restoreLists(queryClient, snapshot);
        },
      },
    });
  };
}

// ─── Transfers & bulk ────────────────────────────────────────────────────────

export function useCreateTransfer(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { handlesErrors: true },
    mutationFn: (input: CreateTransferInput) =>
      api(`/v1/households/${householdId}/transfers`, {
        method: "POST",
        body: input,
        schema: TransferSchema,
        headers: { "idempotency-key": uuidv7() },
      }),
    onSuccess: () => toast.success("Transfer recorded"),
    onError: (error) =>
      toast.error("Couldn't record the transfer", { description: errorMessage(error) }),
    onSettled: () => refreshHousehold(queryClient, householdId),
  });
}

export function useBulkTransactions(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: BulkTransactionAction) =>
      api(`/v1/households/${householdId}/transactions/bulk`, {
        method: "POST",
        body: action,
        schema: BulkTransactionResultSchema,
      }),
    onSettled: () => refreshHousehold(queryClient, householdId),
  });
}
