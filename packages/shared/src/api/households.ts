import { z } from "zod";
import {
  CurrencyCodeSchema,
  IdSchema,
  TimeZoneSchema,
  TimestampSchema,
  nameSchema,
} from "./common.js";

export const HouseholdRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type HouseholdRole = z.infer<typeof HouseholdRoleSchema>;

export const HouseholdSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    baseCurrency: CurrencyCodeSchema,
    timeZone: TimeZoneSchema.meta({
      description: "Used by background jobs to know the household's 'today'",
    }),
    role: HouseholdRoleSchema.meta({ description: "YOUR role in this household" }),
    createdAt: TimestampSchema,
  })
  .meta({ id: "Household" });
export type HouseholdDto = z.infer<typeof HouseholdSchema>;

export const MeSchema = z
  .object({
    id: IdSchema,
    email: z.email(),
    displayName: z.string(),
    mfaEnabled: z.boolean(),
    households: z.array(HouseholdSchema),
  })
  .meta({ id: "Me" });
export type MeDto = z.infer<typeof MeSchema>;

export const HouseholdParamsSchema = z.object({ householdId: IdSchema });

// ─── Household settings ──────────────────────────────────────────────────────

export const CreateHouseholdSchema = z
  .object({
    name: nameSchema(100),
    baseCurrency: CurrencyCodeSchema.default("USD"),
    timeZone: TimeZoneSchema.optional(),
  })
  .meta({ id: "CreateHousehold" });
export type CreateHouseholdInput = z.infer<typeof CreateHouseholdSchema>;

export const UpdateHouseholdSchema = z
  .object({ name: nameSchema(100), timeZone: TimeZoneSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update")
  .meta({ id: "UpdateHousehold" });
export type UpdateHouseholdInput = z.infer<typeof UpdateHouseholdSchema>;

// ─── Members ─────────────────────────────────────────────────────────────────

export const MemberSchema = z
  .object({
    userId: IdSchema,
    displayName: z.string(),
    email: z.email(),
    role: HouseholdRoleSchema,
    joinedAt: TimestampSchema,
    isYou: z.boolean(),
  })
  .meta({ id: "Member" });
export type MemberDto = z.infer<typeof MemberSchema>;

export const MemberParamsSchema = HouseholdParamsSchema.extend({ userId: IdSchema });

export const UpdateMemberSchema = z
  .object({ role: HouseholdRoleSchema })
  .meta({ id: "UpdateMember" });

// ─── Invitations ─────────────────────────────────────────────────────────────

/** New members join as editors or viewers; ownership is granted later, on purpose. */
export const InviteRoleSchema = z.enum(["editor", "viewer"]);

export const InvitationSchema = z
  .object({
    id: IdSchema,
    email: z.email(),
    role: InviteRoleSchema,
    invitedByName: z.string().nullable(),
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
    expired: z.boolean(),
  })
  .meta({ id: "Invitation" });
export type InvitationDto = z.infer<typeof InvitationSchema>;

export const CreateInvitationSchema = z
  .object({ email: z.email().trim().toLowerCase().max(254), role: InviteRoleSchema })
  .meta({ id: "CreateInvitation" });
export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;

export const CreatedInvitationSchema = z
  .object({
    invitation: InvitationSchema,
    /** Returned ONCE, at creation, so the inviter can also share the link directly. */
    inviteUrl: z.url(),
  })
  .meta({ id: "CreatedInvitation" });

export const InvitationTokenParamsSchema = z.object({ token: z.string().min(20).max(100) });

export const InvitationPreviewSchema = z
  .object({
    householdName: z.string(),
    invitedByName: z.string().nullable(),
    email: z.email(),
    role: InviteRoleSchema,
    status: z.enum(["pending", "expired", "accepted", "declined", "revoked"]),
  })
  .meta({ id: "InvitationPreview" });
export type InvitationPreviewDto = z.infer<typeof InvitationPreviewSchema>;

export const AcceptedInvitationSchema = z
  .object({ householdId: IdSchema })
  .meta({ id: "AcceptedInvitation" });
