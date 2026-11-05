import { eq, notifications, users } from "@ledgerly/db";
import { z } from "zod";
import { PermanentJobError, defineJob } from "../../jobs/registry.js";

/**
 * Sends the email for one notification. Email is a side effect we can't take
 * back: if the worker crashes right after the provider accepted the message,
 * the retry sends it AGAIN (at-least-once). Providers that support an
 * idempotency key (we pass the notification id) can drop that duplicate.
 */
export const emailJob = (appUrl: string) =>
  defineJob({
    name: "email.send",
    payload: z.object({ notificationId: z.uuid() }),
    maxAttempts: 8, // providers have bad minutes; keep trying for a while
    run: async ({ notificationId }, { db, mailer }) => {
      const [row] = await db
        .select({
          notification: notifications,
          email: users.email,
          name: users.displayName,
          verified: users.emailVerifiedAt,
        })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.userId))
        .where(eq(notifications.id, notificationId));
      if (!row) throw new PermanentJobError("Notification no longer exists");
      // Only to addresses the user has proven are theirs (Stage 15): someone who
      // signs up with a stranger's address can't make us send that stranger alerts.
      if (!row.verified) return;
      const { notification: n } = row;
      await mailer.send(
        {
          to: row.email,
          subject: n.title,
          text: [
            `Hi ${row.name.split(" ")[0]},`,
            "",
            n.body,
            ...(n.link ? ["", `Open Ledgerly: ${new URL(n.link, appUrl).toString()}`] : []),
            "",
            "— Ledgerly",
          ].join("\n"),
        },
        { idempotencyKey: n.id },
      );
    },
  });
