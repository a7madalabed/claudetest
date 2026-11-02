import {
  and,
  desc,
  eq,
  gt,
  householdInvitations,
  householdMembers,
  households,
  isNull,
  sql,
  users,
  type Database,
  type DbExecutor,
  type HouseholdInvitation,
} from "@ledgerly/db";
import type { CreateInvitationInput, InvitationDto, InvitationPreviewDto } from "@ledgerly/shared";
import { encrypt } from "../../auth/encryption.js";
import { generateToken, sha256 } from "../../auth/tokens.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { enqueue } from "../../jobs/queue.js";

const INVITATION_TTL_DAYS = 7;

const isOpen = and(
  isNull(householdInvitations.acceptedAt),
  isNull(householdInvitations.declinedAt),
  isNull(householdInvitations.revokedAt),
);

const toDto = (row: HouseholdInvitation, invitedByName: string | null): InvitationDto => ({
  id: row.id,
  email: row.email,
  role: row.role as InvitationDto["role"],
  invitedByName,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  expired: row.expiresAt.getTime() <= Date.now(),
});

export async function listInvitations(db: DbExecutor, householdId: string) {
  const rows = await db
    .select({ invitation: householdInvitations, invitedByName: users.displayName })
    .from(householdInvitations)
    .leftJoin(users, eq(users.id, householdInvitations.invitedBy))
    .where(and(eq(householdInvitations.householdId, householdId), isOpen))
    .orderBy(desc(householdInvitations.createdAt));
  return rows.map((r) => toDto(r.invitation, r.invitedByName));
}

/**
 * Creates an invitation and queues its email — atomically.
 *
 * The raw token exists in exactly three places, briefly: this function's
 * memory, the response (so the owner can copy the link), and the email job's
 * payload — ENCRYPTED with the server's key, because job rows sit in the
 * database for days. The database itself stores only the token's hash.
 */
export async function createInvitation(
  db: Database,
  ctx: { householdId: string; userId: string; encryptionKey: Buffer; appUrl: string },
  input: CreateInvitationInput,
) {
  const [member] = await db
    .select({ id: users.id })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(
      and(
        eq(householdMembers.householdId, ctx.householdId),
        sql`lower(${users.email}) = ${input.email}`,
      ),
    );
  if (member)
    throw conflict("already_member", `${input.email} is already a member of this household.`);

  const token = generateToken();
  const invitation = await db.transaction(async (tx) => {
    // An expired invitation to the same person is replaced, not kept forever.
    const [existing] = await tx
      .select()
      .from(householdInvitations)
      .where(
        and(
          eq(householdInvitations.householdId, ctx.householdId),
          sql`lower(${householdInvitations.email}) = ${input.email}`,
          isOpen,
        ),
      )
      .for("update");
    if (existing && existing.expiresAt.getTime() > Date.now()) {
      throw conflict("already_invited", `${input.email} already has a pending invitation.`);
    }
    if (existing) {
      await tx
        .update(householdInvitations)
        .set({ revokedAt: new Date() })
        .where(eq(householdInvitations.id, existing.id));
    }

    const [created] = await tx
      .insert(householdInvitations)
      .values({
        householdId: ctx.householdId,
        email: input.email,
        role: input.role,
        tokenHash: sha256(token),
        invitedBy: ctx.userId,
        expiresAt: sql`now() + make_interval(days => ${INVITATION_TTL_DAYS})`,
      })
      .returning();
    await enqueue(tx, "invitation.send", {
      invitationId: created!.id,
      token: encrypt(token, ctx.encryptionKey),
    });
    return created!;
  });

  const [inviter] = await db
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, ctx.userId));
  return {
    invitation: toDto(invitation, inviter?.name ?? null),
    inviteUrl: new URL(`/invite/${token}`, ctx.appUrl).toString(),
  };
}

export async function revokeInvitation(db: DbExecutor, householdId: string, invitationId: string) {
  const revoked = await db
    .update(householdInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(householdInvitations.householdId, householdId),
        eq(householdInvitations.id, invitationId),
        isOpen,
      ),
    )
    .returning({ id: householdInvitations.id });
  if (revoked.length === 0) throw notFound("Invitation");
}

async function findByToken(db: DbExecutor, token: string) {
  const [row] = await db
    .select({
      invitation: householdInvitations,
      householdName: households.name,
      invitedByName: users.displayName,
    })
    .from(householdInvitations)
    .innerJoin(households, eq(households.id, householdInvitations.householdId))
    .leftJoin(users, eq(users.id, householdInvitations.invitedBy))
    .where(eq(householdInvitations.tokenHash, sha256(token)));
  // Same answer for "no such token" and "wrong token": nothing to learn by guessing.
  if (!row) throw notFound("Invitation");
  return row;
}

function statusOf(row: HouseholdInvitation): InvitationPreviewDto["status"] {
  if (row.acceptedAt) return "accepted";
  if (row.declinedAt) return "declined";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  return "pending";
}

/** What the invite page shows before you sign in: who invited you, to what, as what. */
export async function previewInvitation(
  db: DbExecutor,
  token: string,
): Promise<InvitationPreviewDto> {
  const row = await findByToken(db, token);
  return {
    householdName: row.householdName,
    invitedByName: row.invitedByName,
    email: row.invitation.email,
    role: row.invitation.role as InvitationPreviewDto["role"],
    status: statusOf(row.invitation),
  };
}

const notUsable = (status: string) =>
  new AppError(
    410,
    `invitation_${status}`,
    "Invitation no longer valid",
    `This invitation was ${status}.`,
  );

/**
 * Accept: the invitation must be pending, and addressed to the signed-in
 * user's email — a forwarded or leaked link is useless to anyone else.
 * The row is locked, so a double-click can't add the member twice.
 */
export async function acceptInvitation(
  db: Database,
  token: string,
  user: { id: string; email: string },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.tokenHash, sha256(token)))
      .for("update");
    if (!row) throw notFound("Invitation");
    const status = statusOf(row);
    if (status !== "pending") throw notUsable(status);
    if (row.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new AppError(
        403,
        "invitation_email_mismatch",
        "Wrong account",
        `This invitation is for ${row.email}. Sign in with that email to accept it.`,
      );
    }
    await tx
      .insert(householdMembers)
      .values({ householdId: row.householdId, userId: user.id, role: row.role })
      .onConflictDoNothing(); // already a member (e.g. joined another way): accepting is harmless
    await tx
      .update(householdInvitations)
      .set({ acceptedAt: new Date(), acceptedBy: user.id })
      .where(eq(householdInvitations.id, row.id));
    return { householdId: row.householdId };
  });
}

export async function declineInvitation(db: DbExecutor, token: string, user: { email: string }) {
  const row = await findByToken(db, token);
  const status = statusOf(row.invitation);
  if (status !== "pending") throw notUsable(status);
  if (row.invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new AppError(
      403,
      "invitation_email_mismatch",
      "Wrong account",
      `This invitation is for ${row.invitation.email}.`,
    );
  }
  await db
    .update(householdInvitations)
    .set({ declinedAt: new Date() })
    .where(
      and(
        eq(householdInvitations.id, row.invitation.id),
        gt(householdInvitations.expiresAt, sql`now()`),
      ),
    );
}
