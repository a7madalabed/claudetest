import { accountTokens, and, eq, gt, isNull, sql, users } from "@ledgerly/db";
import { z } from "zod";
import { decrypt } from "../../auth/encryption.js";
import { sha256 } from "../../auth/tokens.js";
import { PermanentJobError, defineJob } from "../../jobs/registry.js";
import type { Email } from "../../lib/mailer.js";

/**
 * Account emails (Stage 15). Queued in the same transaction as the change that
 * causes them (the outbox pattern, Stage 10): no email for a sign-up that rolled
 * back, and no lost email if the process dies right after committing.
 */
export const accountEmailJob = (config: { appUrl: string; encryptionKey: Buffer }) =>
  defineJob({
    name: "account.email",
    payload: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("verify_email"), userId: z.uuid(), token: z.string() }),
      z.object({ kind: z.literal("password_reset"), userId: z.uuid(), token: z.string() }),
      z.object({ kind: z.literal("password_changed"), userId: z.uuid() }),
      // The account no longer exists when this runs, so the payload carries the address.
      z.object({ kind: z.literal("account_deleted"), email: z.email(), name: z.string() }),
    ]),
    maxAttempts: 8,
    run: async (payload, { db, mailer, job }) => {
      const link = (path: string) => new URL(path, config.appUrl).toString();
      let email: Email;

      if (payload.kind === "account_deleted") {
        email = {
          to: payload.email,
          subject: "Your Ledgerly account was deleted",
          text: lines(
            `Hi ${firstName(payload.name)},`,
            "",
            "Your Ledgerly account and its data have been deleted, as you asked.",
            "If you didn't do this, reply to this email straight away.",
          ),
        };
      } else {
        const [user] = await db
          .select({ email: users.email, name: users.displayName })
          .from(users)
          .where(eq(users.id, payload.userId));
        if (!user) return; // the account was deleted in the meantime: nothing to say

        if (payload.kind === "password_changed") {
          email = {
            to: user.email,
            subject: "Your Ledgerly password was changed",
            text: lines(
              `Hi ${firstName(user.name)},`,
              "",
              "The password for your Ledgerly account was just changed, and every device was signed out.",
              "",
              "If this was you, there's nothing to do.",
              `If it wasn't, reset your password now: ${link("/forgot-password")}`,
            ),
          };
        } else {
          const token = decrypt(payload.token, config.encryptionKey);
          // A link that was used, replaced or expired before we got here isn't worth sending.
          const [pending] = await db
            .select({ email: accountTokens.email })
            .from(accountTokens)
            .where(
              and(
                eq(accountTokens.tokenHash, sha256(token)),
                isNull(accountTokens.usedAt),
                gt(accountTokens.expiresAt, sql`now()`),
              ),
            );
          if (!pending) return;
          const url = (path: string) => `${link(path)}?token=${encodeURIComponent(token)}`;
          email =
            payload.kind === "verify_email"
              ? {
                  to: pending.email,
                  subject: "Confirm your email for Ledgerly",
                  text: lines(
                    `Hi ${firstName(user.name)},`,
                    "",
                    `Confirm that ${pending.email} is your address: ${url("/verify-email")}`,
                    "",
                    "The link works for 48 hours. If you didn't create a Ledgerly account, ignore this email.",
                  ),
                }
              : {
                  to: pending.email,
                  subject: "Reset your Ledgerly password",
                  text: lines(
                    `Hi ${firstName(user.name)},`,
                    "",
                    `Choose a new password: ${url("/reset-password")}`,
                    "",
                    "The link works for 1 hour, once. If you didn't ask for this, ignore this email: your password stays as it is.",
                  ),
                };
        }
      }
      if (!email.to) throw new PermanentJobError("No recipient");
      await mailer.send(email, { idempotencyKey: `account:${job.id}` });
    },
  });

const firstName = (name: string) => name.split(" ")[0] || "there";
const lines = (...text: string[]) => [...text, "", "— Ledgerly"].join("\n");
