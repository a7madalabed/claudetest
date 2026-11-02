import {
  and,
  idempotencyKeys,
  inArray,
  jobs,
  lt,
  notifications,
  sessions,
  sql,
} from "@ledgerly/db";
import { z } from "zod";
import { defineJob } from "../../jobs/registry.js";

/**
 * Housekeeping, once a day. Tables that only ever grow eventually slow every
 * query that touches them — and old data you don't need is a liability, not an
 * asset. Each DELETE uses an index (created_at / finished_at / expires_at).
 */
export const cleanupJob = defineJob({
  name: "maintenance.cleanup",
  payload: z.object({}),
  leaseSeconds: 300,
  run: async (_payload, { db, log }) => {
    const ago = (interval: string) => sql`now() - ${interval}::interval`;
    const deleted = {
      succeededJobs: (
        await db
          .delete(jobs)
          .where(and(inArray(jobs.status, ["succeeded"]), lt(jobs.finishedAt, ago("7 days"))))
          .returning({ id: jobs.id })
      ).length,
      failedJobs: (
        await db
          .delete(jobs)
          .where(and(inArray(jobs.status, ["failed"]), lt(jobs.finishedAt, ago("30 days"))))
          .returning({ id: jobs.id })
      ).length,
      // Promised in Stage 4: retries only need replaying for a day.
      idempotencyKeys: (
        await db
          .delete(idempotencyKeys)
          .where(lt(idempotencyKeys.createdAt, ago("24 hours")))
          .returning({ key: idempotencyKeys.key })
      ).length,
      expiredSessions: (
        await db
          .delete(sessions)
          .where(lt(sessions.expiresAt, sql`now()`))
          .returning({ id: sessions.id })
      ).length,
      readNotifications: (
        await db
          .delete(notifications)
          .where(and(lt(notifications.readAt, ago("90 days"))))
          .returning({ id: notifications.id })
      ).length,
    };
    log.info(deleted, "Cleanup finished");
  },
});
