import {
  accountTokens,
  and,
  eq,
  gt,
  isNull,
  sessions,
  sql,
  users,
  type Database,
  type DbTransaction,
} from "@ledgerly/db";
import { encrypt } from "../../auth/encryption.js";
import { hashPassword, passwordWeakness } from "../../auth/password.js";
import { generateToken, sha256 } from "../../auth/tokens.js";
import { enqueue } from "../../jobs/queue.js";
import { AppError, unprocessable } from "../../lib/errors.js";

/*
 * Links sent by email (Stage 15): "reset your password", "confirm your email".
 *
 * The same rules as sessions and invitations:
 *  - the link carries 256 random bits; the database keeps only their SHA-256,
 *    so a leaked database or backup holds no usable links;
 *  - the email job receives the raw token ENCRYPTED (job payloads are stored);
 *  - every link is single-use, expires, and only the newest of its kind works;
 *  - a link is bound to the address it was sent to.
 */

const linkExpired = () =>
  new AppError(
    410,
    "link_expired",
    "Link expired",
    "This link has expired or was already used. Ask for a new one.",
  );

type Purpose = "password_reset" | "email_verification";

async function issueLink(
  tx: DbTransaction,
  user: { id: string; email: string },
  purpose: Purpose,
  ttl: string,
) {
  // Only the newest link of a kind works: retire any older, unused ones.
  await tx
    .update(accountTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(accountTokens.userId, user.id),
        eq(accountTokens.purpose, purpose),
        isNull(accountTokens.usedAt),
      ),
    );
  const token = generateToken();
  await tx.insert(accountTokens).values({
    userId: user.id,
    purpose,
    tokenHash: sha256(token),
    email: user.email,
    expiresAt: sql`now() + ${ttl}::interval`,
  });
  return token;
}

/** Use a link: it must exist, be unused and unexpired. Locks the row, so two clicks can't both succeed. */
async function redeemLink(tx: DbTransaction, token: string, purpose: Purpose) {
  const [link] = await tx
    .select()
    .from(accountTokens)
    .where(
      and(
        eq(accountTokens.tokenHash, sha256(token)),
        eq(accountTokens.purpose, purpose),
        isNull(accountTokens.usedAt),
        gt(accountTokens.expiresAt, sql`now()`),
      ),
    )
    .for("update");
  if (!link) throw linkExpired();
  await tx
    .update(accountTokens)
    .set({ usedAt: sql`now()` })
    .where(eq(accountTokens.id, link.id));
  return link;
}

// ─── Email verification ──────────────────────────────────────────────────────

/** Queue a "confirm your email" message (in the caller's transaction: no email for a rolled-back sign-up). */
export async function sendVerificationEmail(
  tx: DbTransaction,
  key: Buffer,
  user: { id: string; email: string },
) {
  const token = await issueLink(tx, user, "email_verification", "48 hours");
  await enqueue(tx, "account.email", {
    userId: user.id,
    kind: "verify_email",
    token: encrypt(token, key),
  });
}

export async function verifyEmail(db: Database, token: string) {
  return db.transaction(async (tx) => {
    const link = await redeemLink(tx, token, "email_verification");
    // Bound to the address it was sent to: if the account's email changed
    // since, this link proves nothing about the new one.
    const [user] = await tx
      .update(users)
      .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
      .where(and(eq(users.id, link.userId), eq(users.email, link.email)))
      .returning({ id: users.id });
    if (!user) throw linkExpired();
    return user.id;
  });
}

// ─── Password reset ──────────────────────────────────────────────────────────

/**
 * Always "succeeds", whether or not the address has an account: the response
 * must not reveal who has an account ("account enumeration").
 */
export async function requestPasswordReset(db: Database, key: Buffer, email: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email));
    if (!user) return;
    const token = await issueLink(tx, user, "password_reset", "1 hour");
    await enqueue(tx, "account.email", {
      userId: user.id,
      kind: "password_reset",
      token: encrypt(token, key),
    });
  });
}

export async function resetPassword(db: Database, token: string, password: string) {
  return db.transaction(async (tx) => {
    const link = await redeemLink(tx, token, "password_reset");
    const [user] = await tx
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, link.userId));
    if (!user || user.email !== link.email) throw linkExpired();

    const weakness = passwordWeakness(password, user);
    if (weakness) throw unprocessable("weak_password", "password", weakness);

    await tx
      .update(users)
      .set({
        passwordHash: await hashPassword(password),
        // Clicking a link sent to this inbox proves they own it.
        emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
      })
      .where(eq(users.id, user.id));
    // Whoever made a reset necessary may be signed in somewhere: sign out everywhere.
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    await enqueue(tx, "account.email", { userId: user.id, kind: "password_changed" });
    return user;
  });
}
