import type { Database, Job } from "@ledgerly/db";
import type { Logger } from "pino";
import type { z } from "zod";
import type { Mailer } from "../lib/mailer.js";

/**
 * A job type: a name, a payload schema, and the code that runs it.
 *
 * Handlers MUST be idempotent — safe to run twice for the same job. A worker
 * can crash after doing the work but before marking the job done; its lease
 * expires and another worker runs the job again. "At-least-once" delivery is
 * what every real queue (SQS, Sidekiq, BullMQ…) gives you; exactly-once
 * EFFECTS come from the handler (unique keys, upserts, ON CONFLICT DO NOTHING).
 */
export interface JobDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  payload: S;
  /** How long one attempt may hold its lease before another worker may take over. */
  leaseSeconds?: number;
  maxAttempts?: number;
  run: (payload: z.infer<S>, ctx: JobContext) => Promise<void>;
}

export interface JobContext {
  db: Database;
  log: Logger;
  job: Job;
  mailer: Mailer;
  /** Aborted when the worker is shutting down: long jobs should stop at a safe point. */
  signal: AbortSignal;
}

export const defineJob = <S extends z.ZodType>(definition: JobDefinition<S>) => definition;

/** Throw this for failures a retry can't fix (bad input, deleted data): no more attempts. */
export class PermanentJobError extends Error {
  override name = "PermanentJobError";
}
