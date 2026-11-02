"use client";

import {
  AccountSchema,
  CashflowReportSchema,
  CategorySchema,
  LoginResultSchema,
  MeSchema,
  RecoveryCodesSchema,
  SessionSchema,
  TotpSetupSchema,
  TransactionPageSchema,
  type LoginInput,
  type SignupInput,
} from "@ledgerly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../api/client";
import { authFlags } from "./client";
import { queryKeys } from "./keys";

/*
 * Every server interaction the UI makes lives here, as a small typed hook.
 * Components never call fetch() directly: caching, deduplication, loading and
 * error states, and cache invalidation after changes are handled uniformly.
 */

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => api("/v1/me", { schema: MeSchema, signal }),
  });
}

export function useAccounts(householdId: string) {
  return useQuery({
    queryKey: queryKeys.accounts(householdId),
    queryFn: async ({ signal }) =>
      (
        await api(`/v1/households/${householdId}/accounts`, {
          schema: z.object({ data: z.array(AccountSchema) }),
          signal,
        })
      ).data,
  });
}

export function useRecentTransactions(householdId: string, limit = 8) {
  return useQuery({
    queryKey: queryKeys.transactions(householdId, { limit }),
    queryFn: ({ signal }) =>
      api(`/v1/households/${householdId}/transactions?limit=${limit}`, {
        schema: TransactionPageSchema,
        signal,
      }),
  });
}

export function useCashflow(householdId: string, range: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.cashflow(householdId, range),
    queryFn: ({ signal }) =>
      api(`/v1/households/${householdId}/reports/cashflow?from=${range.from}&to=${range.to}`, {
        schema: CashflowReportSchema,
        signal,
      }),
    // Changing the range keeps the old chart (dimmed) until the new data arrives.
    placeholderData: (previous) => previous,
  });
}

export function useSessions() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: async ({ signal }) =>
      (
        await api("/v1/auth/sessions", {
          schema: z.object({ data: z.array(SessionSchema) }),
          signal,
        })
      ).data,
  });
}

// ─── Authentication ──────────────────────────────────────────────────────────

/** Forms show these errors inline, so they opt out of the global error toast. */
const inline = { meta: { handlesErrors: true } } as const;

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    ...inline,
    mutationFn: (input: LoginInput) =>
      api("/v1/auth/login", { method: "POST", body: input, schema: LoginResultSchema }),
    onSuccess: (result) => {
      if (result.status === "authenticated") queryClient.setQueryData(queryKeys.me, result.user);
    },
  });
}

export function useVerifyMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    ...inline,
    mutationFn: (code: string) =>
      api("/v1/auth/login/mfa", { method: "POST", body: { code }, schema: LoginResultSchema }),
    onSuccess: (result) => {
      if (result.status === "authenticated") queryClient.setQueryData(queryKeys.me, result.user);
    },
  });
}

export function useSignup() {
  const queryClient = useQueryClient();
  return useMutation({
    ...inline,
    mutationFn: (input: SignupInput) =>
      api("/v1/auth/signup", {
        method: "POST",
        // The browser knows the user's time zone; the new household adopts it.
        body: { ...input, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        schema: MeSchema,
      }),
    onSuccess: (me) => queryClient.setQueryData(queryKeys.me, me),
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => {
      authFlags.signingOut = true;
      return api("/v1/auth/logout", { method: "POST" });
    },
    // A FULL page load (not client-side navigation) wipes every byte of in-memory
    // state — cached API responses, form drafts — so the next person to use this
    // device sees nothing of the previous user's data.
    onSettled: () => window.location.replace("/login"),
  });
}

// ─── Security settings ───────────────────────────────────────────────────────

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    ...inline,
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api("/v1/auth/password", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api(`/v1/auth/sessions/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api("/v1/auth/sessions/revoke-others", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}

export function useTotpSetup() {
  return useMutation({
    mutationFn: () => api("/v1/auth/mfa/totp/setup", { method: "POST", schema: TotpSetupSchema }),
  });
}

export function useTotpEnable() {
  const queryClient = useQueryClient();
  return useMutation({
    ...inline,
    mutationFn: (code: string) =>
      api("/v1/auth/mfa/totp/enable", {
        method: "POST",
        body: { code },
        schema: RecoveryCodesSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useTotpDisable() {
  const queryClient = useQueryClient();
  return useMutation({
    ...inline,
    mutationFn: (input: { password: string; code: string }) =>
      api("/v1/auth/mfa/totp/disable", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useCategories(householdId: string) {
  return useQuery({
    queryKey: ["households", householdId, "categories"],
    queryFn: async ({ signal }) =>
      (
        await api(`/v1/households/${householdId}/categories`, {
          schema: z.object({ data: z.array(CategorySchema) }),
          signal,
        })
      ).data,
    staleTime: 5 * 60_000, // categories rarely change
  });
}
