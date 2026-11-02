"use client";

import {
  ImportSchema,
  ImportUploadResultSchema,
  NotificationListSchema,
  RecurringRuleSchema,
  type CreateRecurringRuleInput,
  type ImportDto,
  type ImportMapping,
} from "@ledgerly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../api/client";

const base = (householdId: string) => `/v1/households/${householdId}`;

export const automationKeys = {
  imports: (householdId: string) => ["households", householdId, "imports"] as const,
  import: (householdId: string, id: string) => ["households", householdId, "imports", id] as const,
  rules: (householdId: string) => ["households", householdId, "recurring-rules"] as const,
  notifications: ["notifications"] as const,
};

// ─── Imports ─────────────────────────────────────────────────────────────────

const RUNNING: ImportDto["status"][] = ["queued", "processing"];

export function useImports(householdId: string) {
  return useQuery({
    queryKey: automationKeys.imports(householdId),
    queryFn: async ({ signal }) =>
      (
        await api(`${base(householdId)}/imports`, {
          schema: z.object({ data: z.array(ImportSchema) }),
          signal,
        })
      ).data,
  });
}

/**
 * One import. While it's running, ask again every 700 ms ("polling") — simple,
 * works through every proxy and firewall, and good enough for a progress bar.
 * Stage 11 replaces polling with the server PUSHING updates.
 */
export function useImport(householdId: string, importId: string | null) {
  return useQuery({
    queryKey: automationKeys.import(householdId, importId ?? "none"),
    queryFn: ({ signal }) =>
      api(`${base(householdId)}/imports/${importId}`, { schema: ImportSchema, signal }),
    enabled: Boolean(importId),
    refetchInterval: (query) =>
      query.state.data && RUNNING.includes(query.state.data.status) ? 700 : false,
  });
}

export function useUploadImport(householdId: string) {
  return useMutation({
    meta: { handlesErrors: true },
    mutationFn: ({ accountId, file, text }: { accountId: string; file: File; text: string }) =>
      api(
        `${base(householdId)}/imports?accountId=${accountId}&fileName=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          rawBody: { contentType: "text/csv", data: text },
          schema: ImportUploadResultSchema,
        },
      ),
  });
}

function useImportAction<TInput>(
  householdId: string,
  request: (input: TInput) => Promise<ImportDto | void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (result) => {
      if (result) queryClient.setQueryData(automationKeys.import(householdId, result.id), result);
    },
    // A revert deletes transactions: refresh everything in the household.
    // NOT returned: returning the promise would make the mutation wait for every
    // refetch before calling the caller's callbacks.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["households", householdId] }),
  });
}

export const useStartImport = (householdId: string) =>
  useImportAction(householdId, ({ id, mapping }: { id: string; mapping: ImportMapping }) =>
    api(`${base(householdId)}/imports/${id}/start`, {
      method: "POST",
      body: { mapping },
      schema: ImportSchema,
    }),
  );

export const useRevertImport = (householdId: string) =>
  useImportAction(householdId, (id: string) =>
    api(`${base(householdId)}/imports/${id}/revert`, { method: "POST", schema: ImportSchema }),
  );

export const useDiscardImport = (householdId: string) =>
  useImportAction(householdId, async (id: string) => {
    await api(`${base(householdId)}/imports/${id}`, { method: "DELETE" });
  });

// ─── Recurring rules ─────────────────────────────────────────────────────────

export function useRecurringRules(householdId: string) {
  return useQuery({
    queryKey: automationKeys.rules(householdId),
    queryFn: async ({ signal }) =>
      (
        await api(`${base(householdId)}/recurring-rules`, {
          schema: z.object({ data: z.array(RecurringRuleSchema) }),
          signal,
        })
      ).data,
  });
}

function useRuleMutation<TInput>(
  householdId: string,
  request: (input: TInput) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.rules(householdId) });
      void queryClient.invalidateQueries({
        queryKey: ["households", householdId, "reports", "recurring"],
      });
    },
  });
}

export const useCreateRule = (householdId: string) =>
  useRuleMutation(householdId, (input: CreateRecurringRuleInput) =>
    api(`${base(householdId)}/recurring-rules`, {
      method: "POST",
      body: input,
      schema: RecurringRuleSchema,
    }),
  );

export const useToggleRule = (householdId: string) =>
  useRuleMutation(householdId, ({ id, active }: { id: string; active: boolean }) =>
    api(`${base(householdId)}/recurring-rules/${id}`, {
      method: "PATCH",
      body: { active },
      schema: RecurringRuleSchema,
    }),
  );

export const useDeleteRule = (householdId: string) =>
  useRuleMutation(householdId, (id: string) =>
    api(`${base(householdId)}/recurring-rules/${id}`, { method: "DELETE" }),
  );

// ─── Notifications ───────────────────────────────────────────────────────────

/**
 * Notifications are created by background jobs, so nothing in THIS tab knows
 * when one appears. We poll every 15 s — only while the tab is visible
 * (TanStack Query pauses intervals in background tabs) — and right after the
 * user changes data (that's when new alerts are most likely).
 */
export function useNotifications() {
  return useQuery({
    queryKey: automationKeys.notifications,
    queryFn: ({ signal }) => api("/v1/notifications", { schema: NotificationListSchema, signal }),
    refetchInterval: 15_000,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) =>
      api("/v1/notifications/read", {
        method: "POST",
        body: ids ? { ids } : {},
        schema: NotificationListSchema,
      }),
    onSuccess: (list) => queryClient.setQueryData(automationKeys.notifications, list),
  });
}
