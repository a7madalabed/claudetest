"use client";

import { AccountSchema, type CreateAccountInput, type UpdateAccountInput } from "@ledgerly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../api/client";
import { queryKeys } from "./keys";

/*
 * Managing accounts (Stage 16). Until now the web app could only LIST them, so
 * a new household had no way to record its first transaction.
 */

const base = (householdId: string) => `/v1/households/${householdId}/accounts`;

/** Every account INCLUDING archived ones: the Accounts page lets you bring one back. */
export function useAllAccounts(householdId: string) {
  return useQuery({
    queryKey: [...queryKeys.accounts(householdId), "with-archived"] as const,
    queryFn: async ({ signal }) =>
      (
        await api(`${base(householdId)}?includeArchived=true`, {
          schema: z.object({ data: z.array(AccountSchema) }),
          signal,
        })
      ).data,
  });
}

/**
 * Balances feed the dashboard, goals and reports, so any change refreshes
 * everything under the household. Forms show errors next to their fields, so
 * these opt out of the global error toast.
 */
function useAccountMutation<TInput, TResult>(
  householdId: string,
  request: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    meta: { handlesErrors: true },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.household(householdId) }),
  });
}

export const useCreateAccount = (householdId: string) =>
  useAccountMutation(householdId, (input: CreateAccountInput) =>
    api(base(householdId), { method: "POST", body: input, schema: AccountSchema }),
  );

export const useUpdateAccount = (householdId: string) =>
  useAccountMutation(householdId, ({ id, changes }: { id: string; changes: UpdateAccountInput }) =>
    api(`${base(householdId)}/${id}`, { method: "PATCH", body: changes, schema: AccountSchema }),
  );

export const useDeleteAccount = (householdId: string) =>
  useAccountMutation(householdId, (id: string) =>
    api(`${base(householdId)}/${id}`, { method: "DELETE" }),
  );
