"use client";

import {
  BudgetMonthSchema,
  BudgetSchema,
  GoalSchema,
  RecurringReportSchema,
  type CreateBudgetInput,
  type CreateGoalInput,
  type UpdateBudgetInput,
  type UpdateGoalInput,
} from "@ledgerly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../api/client";

const base = (householdId: string) => `/v1/households/${householdId}`;

export const budgetKeys = {
  all: (householdId: string) => ["households", householdId, "budgets"] as const,
  month: (householdId: string, month: string) =>
    ["households", householdId, "budgets", month] as const,
  goals: (householdId: string) => ["households", householdId, "goals"] as const,
  recurring: (householdId: string) => ["households", householdId, "reports", "recurring"] as const,
};

export function useBudgets(householdId: string, month: string, { enabled = true } = {}) {
  return useQuery({
    enabled,
    queryKey: budgetKeys.month(householdId, month),
    queryFn: ({ signal }) =>
      api(`${base(householdId)}/budgets?month=${month}`, { schema: BudgetMonthSchema, signal }),
    // Switching months keeps the previous month on screen until the new one arrives.
    placeholderData: (previous) => previous,
  });
}

/**
 * Budget changes ripple: a new amount changes this month AND (with rollover)
 * every later month, plus the dashboard widget. Invalidating the whole
 * "budgets" prefix refetches whichever of those are on screen.
 */
function useBudgetMutation<TInput, TResult>(
  householdId: string,
  request: (input: TInput) => Promise<TResult>,
  /** Forms show errors next to the field, so they opt out of the global error toast. */
  handlesErrors = false,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    meta: { handlesErrors },
    onSettled: () => queryClient.invalidateQueries({ queryKey: budgetKeys.all(householdId) }),
  });
}

export const useCreateBudget = (householdId: string) =>
  useBudgetMutation(
    householdId,
    (input: CreateBudgetInput) =>
      api(`${base(householdId)}/budgets`, { method: "POST", body: input, schema: BudgetSchema }),
    true,
  );

export const useUpdateBudget = (householdId: string) =>
  useBudgetMutation(
    householdId,
    ({ id, changes }: { id: string; changes: UpdateBudgetInput }) =>
      api(`${base(householdId)}/budgets/${id}`, {
        method: "PATCH",
        body: changes,
        schema: BudgetSchema,
      }),
    true,
  );

export const useDeleteBudget = (householdId: string) =>
  useBudgetMutation(householdId, (id: string) =>
    api(`${base(householdId)}/budgets/${id}`, { method: "DELETE" }),
  );

// ─── Goals ───────────────────────────────────────────────────────────────────

export function useGoals(householdId: string) {
  return useQuery({
    queryKey: budgetKeys.goals(householdId),
    queryFn: async ({ signal }) =>
      // No ?today=: "today" is the household's, and the server knows its zone (Stage 17).
      (
        await api(`${base(householdId)}/goals`, {
          schema: z.object({ data: z.array(GoalSchema) }),
          signal,
        })
      ).data,
  });
}

function useGoalMutation<TInput, TResult>(
  householdId: string,
  request: (input: TInput) => Promise<TResult>,
  /** Forms show errors next to the field, so they opt out of the global error toast. */
  handlesErrors = false,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    meta: { handlesErrors },
    onSettled: () => queryClient.invalidateQueries({ queryKey: budgetKeys.goals(householdId) }),
  });
}

export const useCreateGoal = (householdId: string) =>
  useGoalMutation(
    householdId,
    (input: CreateGoalInput) =>
      api(`${base(householdId)}/goals`, { method: "POST", body: input, schema: GoalSchema }),
    true,
  );

export const useUpdateGoal = (householdId: string) =>
  useGoalMutation(
    householdId,
    ({ id, changes }: { id: string; changes: UpdateGoalInput }) =>
      api(`${base(householdId)}/goals/${id}`, {
        method: "PATCH",
        body: changes,
        schema: GoalSchema,
      }),
    true,
  );

export const useDeleteGoal = (householdId: string) =>
  useGoalMutation(householdId, (id: string) =>
    api(`${base(householdId)}/goals/${id}`, { method: "DELETE" }),
  );

// ─── Recurring ───────────────────────────────────────────────────────────────

export function useRecurring(householdId: string) {
  return useQuery({
    queryKey: budgetKeys.recurring(householdId),
    queryFn: ({ signal }) =>
      api(`${base(householdId)}/reports/recurring`, {
        schema: RecurringReportSchema,
        signal,
      }),
    staleTime: 5 * 60_000, // derived from months of history: it changes slowly
  });
}
