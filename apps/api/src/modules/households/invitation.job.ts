import { eq, householdInvitations, households, users } from "@ledgerly/db";
import { z } from "zod";
import { decrypt } from "../../auth/encryption.js";
import { PermanentJobError, defineJob } from "../../jobs/registry.js";

/** Emails the invitation link. The token arrives encrypted (see createInvitation). */
export const invitationEmailJob = (config: { appUrl: string; encryptionKey: Buffer }) =>
  defineJob({
    name: "invitation.send",
    payload: z.object({ invitationId: z.uuid(), token: z.string() }),
    maxAttempts: 8,
    run: async ({ invitationId, token }, { db, mailer }) => {
      const [row] = await db
        .select({
          invitation: householdInvitations,
          householdName: households.name,
          inviter: users.displayName,
        })
        .from(householdInvitations)
        .innerJoin(households, eq(households.id, householdInvitations.householdId))
        .leftJoin(users, eq(users.id, householdInvitations.invitedBy))
        .where(eq(householdInvitations.id, invitationId));
      if (!row) throw new PermanentJobError("Invitation no longer exists");
      const { invitation } = row;
      // Revoked or used before the email went out? Then don't send a dead link.
      if (invitation.revokedAt || invitation.acceptedAt || invitation.declinedAt) return;

      const link = new URL(`/invite/${decrypt(token, config.encryptionKey)}`, config.appUrl);
      await mailer.send(
        {
          to: invitation.email,
          subject: `${row.inviter ?? "Someone"} invited you to ${row.householdName} on Ledgerly`,
          text: [
            "Hi,",
            "",
            `${row.inviter ?? "Someone"} invited you to join “${row.householdName}” on Ledgerly as ${invitation.role === "editor" ? "an editor" : "a viewer"}.`,
            "",
            `Accept the invitation: ${link.toString()}`,
            "",
            `The link works for 7 days, and only for ${invitation.email}.`,
            "If you weren't expecting this, you can ignore this email.",
            "",
            "— Ledgerly",
          ].join("\n"),
        },
        { idempotencyKey: `invitation:${invitation.id}` },
      );
    },
  });
