"use client";

import {
  CategorySchema,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from "@ledgerly/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys } from "./keys";

/*
 * Managing categories (Stage 17). Reading them is useCategories() in hooks.ts,
 * which already returns archived ones too, flagged.
 */

const base = (householdId: string) => `/v1/households/${householdId}/categories`;

/** Categories label transactions, budgets and reports: refresh the whole household. */
function useCategoryMutation<TInput, TResult>(
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

export const useCreateCategory = (householdId: string) =>
  useCategoryMutation(householdId, (input: CreateCategoryInput) =>
    api(base(householdId), { method: "POST", body: input, schema: CategorySchema }),
  );

export const useUpdateCategory = (householdId: string) =>
  useCategoryMutation(
    householdId,
    ({ id, changes }: { id: string; changes: UpdateCategoryInput }) =>
      api(`${base(householdId)}/${id}`, { method: "PATCH", body: changes, schema: CategorySchema }),
  );

export const useDeleteCategory = (householdId: string) =>
  useCategoryMutation(householdId, (id: string) =>
    api(`${base(householdId)}/${id}`, { method: "DELETE" }),
  );
