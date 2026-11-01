import { and, eq, gt, ne, sessions, sql, users, type DbExecutor, type Session } from "@ledgerly/db";
import type { SessionDto } from "@ledgerly/shared";
import { generateToken, sha256 } from "../../auth/tokens.js";
import { notFound } from "../../lib/errors.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A session that has passed the password step but not 2FA lives only briefly. */
const MFA_PENDING_TTL_MS = 10 * 60 * 1000;

export interface SessionMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Creates a session and returns the RAW token (for the cookie). Only its hash is
 * stored. Called on every successful sign-in: we never reuse an existing session
 * id after authentication, which prevents "session fixation" attacks.
 */
export async function createSession(
  db: DbExecutor,
  input: { userId: string; mfaPending?: boolean; ttlDays: number } & SessionMeta,
) {
  const token = generateToken();
  const ttlMs = input.mfaPending ? MFA_PENDING_TTL_MS : input.ttlDays * DAY_MS;
  const [session] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: sha256(token),
      mfaPending: input.mfaPending ?? false,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + ttlMs),
    })
    .returning();
  return { token, session: session! };
}

/** Looks up a session by its raw token, enforcing BOTH absolute and idle expiry. */
export async function findSession(db: DbExecutor, token: string, idleDays: number) {
  const [row] = await db
    .select({
      session: sessions,
      user: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        totpEnabledAt: users.totpEnabledAt,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        gt(sessions.expiresAt, sql`now()`),
        gt(sessions.lastSeenAt, sql`now() - make_interval(days => ${idleDays})`),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Records activity for the idle timeout — but at most every 5 minutes, so a busy
 * user doesn't cause a database WRITE on every single request.
 */
export async function touchSession(db: DbExecutor, session: Session) {
  if (Date.now() - session.lastSeenAt.getTime() < 5 * 60 * 1000) return;
  await db
    .update(sessions)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(sessions.id, session.id));
}

export async function deleteSession(db: DbExecutor, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeSession(db: DbExecutor, userId: string, sessionId: string) {
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)))
    .returning({ id: sessions.id });
  if (deleted.length === 0) throw notFound("Session");
}

/** "Sign out everywhere else" — also used after a password change. */
export async function revokeOtherSessions(db: DbExecutor, userId: string, keepSessionId: string) {
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
}

export async function listSessions(
  db: DbExecutor,
  userId: string,
  currentSessionId: string,
): Promise<SessionDto[]> {
  const rows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.mfaPending, false),
        gt(sessions.expiresAt, sql`now()`),
      ),
    )
    .orderBy(sql`${sessions.lastSeenAt} desc`);
  return rows.map((row) => ({
    id: row.id,
    current: row.id === currentSessionId,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}
