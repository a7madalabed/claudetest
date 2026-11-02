"use client";

import {
  AcceptedInvitationSchema,
  CreatedInvitationSchema,
  InvitationPreviewSchema,
  InvitationSchema,
  MeSchema,
  MemberSchema,
  type CreateHouseholdInput,
  type CreateInvitationInput,
  type HouseholdRole,
  type UpdateHouseholdInput,
} from "@ledgerly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../api/client";
import { queryKeys } from "./keys";

const base = (householdId: string) => `/v1/households/${householdId}`;
export const householdKeys = {
  members: (householdId: string) => ["households", householdId, "members"] as const,
  invitations: (householdId: string) => ["households", householdId, "invitations"] as const,
};

export function useMembers(householdId: string) {
  return useQuery({
    queryKey: householdKeys.members(householdId),
    queryFn: async ({ signal }) =>
      (
        await api(`${base(householdId)}/members`, {
          schema: z.object({ data: z.array(MemberSchema) }),
          signal,
        })
      ).data,
  });
}

export function useInvitations(householdId: string, { enabled = true } = {}) {
  return useQuery({
    queryKey: householdKeys.invitations(householdId),
    queryFn: async ({ signal }) =>
      (
        await api(`${base(householdId)}/invitations`, {
          schema: z.object({ data: z.array(InvitationSchema) }),
          signal,
        })
      ).data,
    enabled,
  });
}

/*
 * No optimistic updates here: membership changes are rare, consequential, and
 * other people see them. Wait for the server, then refetch — the live stream
 * updates everyone else's screens at the same moment.
 */
function useHouseholdMutation<TInput, TResult>(
  householdId: string,
  request: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    meta: { handlesErrors: true },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: householdKeys.members(householdId) });
      void queryClient.invalidateQueries({ queryKey: householdKeys.invitations(householdId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export const useChangeRole = (householdId: string) =>
  useHouseholdMutation(householdId, ({ userId, role }: { userId: string; role: HouseholdRole }) =>
    api(`${base(householdId)}/members/${userId}`, { method: "PATCH", body: { role } }),
  );

export const useRemoveMember = (householdId: string) =>
  useHouseholdMutation(householdId, (userId: string) =>
    api(`${base(householdId)}/members/${userId}`, { method: "DELETE" }),
  );

export const useInvite = (householdId: string) =>
  useHouseholdMutation(householdId, (input: CreateInvitationInput) =>
    api(`${base(householdId)}/invitations`, {
      method: "POST",
      body: input,
      schema: CreatedInvitationSchema,
    }),
  );

export const useRevokeInvitation = (householdId: string) =>
  useHouseholdMutation(householdId, (invitationId: string) =>
    api(`${base(householdId)}/invitations/${invitationId}`, { method: "DELETE" }),
  );

export const useUpdateHousehold = (householdId: string) =>
  useHouseholdMutation(householdId, (input: UpdateHouseholdInput) =>
    api(base(householdId), { method: "PATCH", body: input }),
  );

export function useCreateHousehold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHouseholdInput) =>
      api("/v1/households", { method: "POST", body: input, schema: MeSchema }),
    onSuccess: (me) => queryClient.setQueryData(queryKeys.me, me),
  });
}

// ─── The invitee's side ──────────────────────────────────────────────────────

export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ["invitation", token],
    queryFn: ({ signal }) =>
      api(`/v1/invitations/${token}`, { schema: InvitationPreviewSchema, signal }),
    retry: false,
  });
}

export function useAcceptInvitation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { handlesErrors: true },
    mutationFn: () =>
      api(`/v1/invitations/${token}/accept`, { method: "POST", schema: AcceptedInvitationSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useDeclineInvitation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { handlesErrors: true },
    mutationFn: () => api(`/v1/invitations/${token}/decline`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invitation", token] }),
  });
}
