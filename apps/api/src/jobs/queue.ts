import { jobs, sql, type DbExecutor } from "@ledgerly/db";

export const JOBS_CHANNEL = "ledgerly_jobs";

export interface EnqueueOptions {
  /** Run no earlier than this many milliseconds from now. */
  delayMs?: number;
  /**
   * While a job with this key is still QUEUED, enqueuing another is a no-op.
   * Use it to coalesce bursts ("evaluate budgets for household X") into one run.
   */
  singletonKey?: string;
  maxAttempts?: number;
}

/**
 * Adds a job to the queue. Pass a TRANSACTION as `db` to enqueue atomically with
 * the change that needs the job ("transactional outbox"): if the change rolls
 * back, the job never existed; if it commits, the job is guaranteed to be there.
 *
 * `pg_notify` wakes idle workers immediately. Postgres delivers notifications
 * only when the transaction COMMITS, so a worker can never see a job that's
 * still invisible to it.
 */
export async function enqueue(
  db: DbExecutor,
  name: string,
  payload: Record<string, unknown> = {},
  options: EnqueueOptions = {},
) {
  const [job] = await db
    .insert(jobs)
    .values({
      name,
      payload,
      singletonKey: options.singletonKey,
      maxAttempts: options.maxAttempts,
      runAt: options.delayMs
        ? sql`now() + make_interval(secs => ${options.delayMs / 1000})`
        : undefined,
    })
    .onConflictDoNothing({ target: jobs.singletonKey, where: sql`status = 'queued'` })
    .returning({ id: jobs.id });
  await db.execute(sql`select pg_notify(${JOBS_CHANNEL}, ${name})`);
  return job?.id ?? null; // null: an identical singleton job was already queued
}
