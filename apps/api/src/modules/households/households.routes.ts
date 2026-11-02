import { and, eq, householdMembers, households } from "@ledgerly/db";
import {
  AcceptedInvitationSchema,
  CreateHouseholdSchema,
  CreateInvitationSchema,
  CreatedInvitationSchema,
  HouseholdParamsSchema,
  HouseholdSchema,
  IdSchema,
  InvitationPreviewSchema,
  InvitationSchema,
  InvitationTokenParamsSchema,
  MeSchema,
  MemberParamsSchema,
  MemberSchema,
  UpdateHouseholdSchema,
  UpdateMemberSchema,
  type HouseholdDto,
} from "@ledgerly/shared";
import { z } from "zod";
import * as invitations from "./invitations.service.js";
import * as members from "./members.service.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { notFound } from "../../lib/errors.js";
import { getMe } from "./households.service.js";
import { commonProblems, problems } from "../../lib/responses.js";

const membershipColumns = {
  id: households.id,
  name: households.name,
  baseCurrency: households.baseCurrency,
  timeZone: households.timeZone,
  role: householdMembers.role,
  createdAt: households.createdAt,
};

const toDto = (row: {
  id: string;
  name: string;
  baseCurrency: string;
  timeZone: string;
  role: HouseholdDto["role"];
  createdAt: Date;
}): HouseholdDto => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

/** GET /v1/me — who am I, and which households can I access? */
export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    {
      onRequest: app.authenticate,
      schema: {
        tags: ["Households"],
        summary: "The current user and their households",
        response: { 200: MeSchema, ...problems(401) },
      },
    },
    async (request) => getMe(app.db, request.user!.id),
  );

  app.post(
    "/households",
    {
      onRequest: app.authenticate,
      schema: {
        tags: ["Households"],
        summary: "Create a household (you become its owner)",
        body: CreateHouseholdSchema,
        response: { 201: MeSchema, ...problems(400, 401) },
      },
    },
    async (request, reply) => {
      await members.createHousehold(app.db, request.user!.id, request.body);
      return reply.status(201).send(await getMe(app.db, request.user!.id));
    },
  );
};

type InviteOptions = { encryptionKey: Buffer; appUrl: string };

/**
 * Invitation links, used by the INVITEE — who isn't a member yet, so these live
 * outside the household scope. Previewing needs no account (the page must show
 * "Alex invited you to…" before you sign up), so it's rate-limited: tokens are
 * unguessable, but nobody should get to try millions of them.
 */
export const invitationRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ["Invitations"];

  app.get(
    "/invitations/:token",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Preview an invitation (no sign-in needed)",
        params: InvitationTokenParamsSchema,
        response: { 200: InvitationPreviewSchema, ...problems(404, 429) },
      },
    },
    async (request) => invitations.previewInvitation(app.db, request.params.token),
  );

  app.post(
    "/invitations/:token/accept",
    {
      onRequest: app.authenticate,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Join the household (the invitation must be for your email)",
        params: InvitationTokenParamsSchema,
        response: { 200: AcceptedInvitationSchema, ...problems(401, 403, 404, 410, 429) },
      },
    },
    async (request) =>
      invitations.acceptInvitation(app.db, request.params.token, {
        id: request.user!.id,
        email: request.user!.email,
      }),
  );

  app.post(
    "/invitations/:token/decline",
    {
      onRequest: app.authenticate,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Decline an invitation",
        params: InvitationTokenParamsSchema,
        response: { 204: z.null(), ...problems(401, 403, 404, 410, 429) },
      },
    },
    async (request, reply) => {
      await invitations.declineInvitation(app.db, request.params.token, request.user!);
      return reply.status(204).send(null);
    },
  );
};

/** /v1/households/:householdId/… (registered inside the household scope). */
export const householdRoutes: FastifyPluginAsyncZod<InviteOptions> = async (app, opts) => {
  const owner = { minRole: "owner" as const };
  app.get(
    "/",
    {
      schema: {
        tags: ["Households"],
        summary: "Get a household",
        params: HouseholdParamsSchema,
        response: { 200: HouseholdSchema, ...commonProblems },
      },
    },
    async (request) => {
      const [row] = await app.db
        .select(membershipColumns)
        .from(householdMembers)
        .innerJoin(households, eq(households.id, householdMembers.householdId))
        .where(
          and(
            eq(householdMembers.householdId, request.params.householdId),
            eq(householdMembers.userId, request.user!.id),
          ),
        );
      if (!row) throw notFound("Household");
      return toDto(row);
    },
  );

  app.patch(
    "/",
    {
      config: owner,
      schema: {
        tags: ["Households"],
        summary: "Rename the household or change its time zone (owners)",
        params: HouseholdParamsSchema,
        body: UpdateHouseholdSchema,
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await members.updateHousehold(app.db, request.params.householdId, request.body);
      return reply.status(204).send(null);
    },
  );

  // ─── Members ───────────────────────────────────────────────────────────────

  app.get(
    "/members",
    {
      schema: {
        tags: ["Members"],
        summary: "Everyone in the household and their role",
        params: HouseholdParamsSchema,
        response: { 200: z.object({ data: z.array(MemberSchema) }), ...commonProblems },
      },
    },
    async (request) => ({
      data: await members.listMembers(app.db, request.params.householdId, request.user!.id),
    }),
  );

  app.patch(
    "/members/:userId",
    {
      config: owner,
      schema: {
        tags: ["Members"],
        summary: "Change a member's role (owners)",
        params: MemberParamsSchema,
        body: UpdateMemberSchema,
        response: { 204: z.null(), ...commonProblems, ...problems(409) },
      },
    },
    async (request, reply) => {
      await members.changeRole(
        app.db,
        request.params.householdId,
        request.params.userId,
        request.body.role,
      );
      return reply.status(204).send(null);
    },
  );

  app.delete(
    "/members/:userId",
    {
      // Anyone may LEAVE; removing someone else is checked in the service (owners only).
      config: { minRole: "viewer" },
      schema: {
        tags: ["Members"],
        summary: "Remove a member (owners), or leave (yourself)",
        params: MemberParamsSchema,
        response: { 204: z.null(), ...commonProblems, ...problems(409) },
      },
    },
    async (request, reply) => {
      await members.removeMember(
        app.db,
        request.params.householdId,
        { userId: request.user!.id, role: request.household!.role },
        request.params.userId,
      );
      return reply.status(204).send(null);
    },
  );

  // ─── Invitations (managed by owners) ───────────────────────────────────────

  app.get(
    "/invitations",
    {
      config: owner,
      schema: {
        tags: ["Invitations"],
        summary: "Pending invitations",
        params: HouseholdParamsSchema,
        response: { 200: z.object({ data: z.array(InvitationSchema) }), ...commonProblems },
      },
    },
    async (request) => ({
      data: await invitations.listInvitations(app.db, request.params.householdId),
    }),
  );

  app.post(
    "/invitations",
    {
      config: { ...owner, rateLimit: { max: 20, timeWindow: "1 hour" } },
      schema: {
        tags: ["Invitations"],
        summary: "Invite someone by email (they get a link valid for 7 days)",
        params: HouseholdParamsSchema,
        body: CreateInvitationSchema,
        response: { 201: CreatedInvitationSchema, ...commonProblems, ...problems(409, 429) },
      },
    },
    async (request, reply) => {
      const created = await invitations.createInvitation(
        app.db,
        {
          householdId: request.params.householdId,
          userId: request.user!.id,
          encryptionKey: opts.encryptionKey,
          appUrl: opts.appUrl,
        },
        request.body,
      );
      return reply.status(201).send(created);
    },
  );

  app.delete(
    "/invitations/:invitationId",
    {
      config: owner,
      schema: {
        tags: ["Invitations"],
        summary: "Revoke an invitation (its link stops working)",
        params: HouseholdParamsSchema.extend({ invitationId: IdSchema }),
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await invitations.revokeInvitation(
        app.db,
        request.params.householdId,
        request.params.invitationId,
      );
      return reply.status(204).send(null);
    },
  );
};
