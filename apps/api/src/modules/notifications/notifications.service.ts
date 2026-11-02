import {
  and,
  count,
  desc,
  eq,
  householdMembers,
  inArray,
  isNull,
  notifications,
  type DbExecutor,
  type Notification,
} from "@ledgerly/db";
import type { NotificationDto } from "@ledgerly/shared";
import { enqueue } from "../../jobs/queue.js";

const toDto = (row: Notification): NotificationDto => ({
  id: row.id,
  householdId: row.householdId,
  kind: row.kind,
  title: row.title,
  body: row.body,
  link: row.link,
  readAt: row.readAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

export interface NotifyInput {
  householdId: string;
  /** Who to tell. Omit to notify every member of the household. */
  userIds?: string[];
  kind: string;
  title: string;
  body: string;
  link?: string;
  /**
   * The SAME event always gets the same key ("budget:<id>:2026-11:over"). The
   * unique index on (user_id, dedupe_key) turns repeats into no-ops, so a job
   * that runs twice can never notify twice.
   */
  dedupeKey: string;
  email?: boolean;
}

/** Creates notifications (exactly once per user and key) and queues their emails. */
export async function notify(db: DbExecutor, input: NotifyInput) {
  const userIds =
    input.userIds ??
    (
      await db
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(eq(householdMembers.householdId, input.householdId))
    ).map((m) => m.userId);
  if (userIds.length === 0) return [];

  const created = await db
    .insert(notifications)
    .values(
      userIds.map((userId) => ({
        userId,
        householdId: input.householdId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        link: input.link,
        dedupeKey: input.dedupeKey,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  if (input.email) {
    for (const { id } of created) {
      await enqueue(db, "email.send", { notificationId: id }, { singletonKey: `email:${id}` });
    }
  }
  return created;
}

export async function listNotifications(db: DbExecutor, userId: string) {
  const [rows, [unread]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(30),
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { data: rows.map(toDto), unreadCount: unread?.n ?? 0 };
}

export async function markRead(db: DbExecutor, userId: string, ids?: string[]) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined,
      ),
    );
}
