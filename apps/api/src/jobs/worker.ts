import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { and, eq, inArray, jobSchedules, jobs, sql, type Database, type Job } from "@ledgerly/db";
import type pg from "pg";
import type { Logger } from "pino";
import type { Mailer } from "../lib/mailer.js";
import { JOBS_CHANNEL, enqueue } from "./queue.js";
import { PermanentJobError, type JobDefinition } from "./registry.js";

export interface Schedule {
  /** Unique schedule name; also the job it enqueues. */
  job: string;
  everySeconds: number;
  payload?: Record<string, unknown>;
}

export interface WorkerOptions {
  db: Database;
  /** Needed only for LISTEN (a dedicated connection). Without it the worker just polls. */
  pool?: pg.Pool;
  definitions: JobDefinition[];
  schedules?: Schedule[];
  mailer: Mailer;
  log: Logger;
  concurrency?: number;
  pollIntervalMs?: number;
}

const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_MAX_ATTEMPTS = 5;

/** 10 s, 20 s, 40 s… capped at 1 hour, ±50% random "jitter" so retries don't stampede together. */
export function backoffMs(attempt: number, random = Math.random) {
  const base = Math.min(10_000 * 2 ** (attempt - 1), 3_600_000);
  return Math.round(base * (0.5 + random()));
}

/**
 * Runs jobs from the `jobs` table.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`: each worker locks the rows it takes
 * and SKIPS rows other workers have locked, instead of waiting for them. Run
 * one worker or twenty — no job is ever handed to two of them at once.
 *
 * A claimed job gets a LEASE (locked_until). Long jobs renew it while they work
 * (a "heartbeat"). If a worker dies, the lease runs out and another worker
 * takes the job over: crashes delay jobs, they never lose them.
 */
export class Worker {
  readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly definitions: Map<string, JobDefinition>;
  private readonly inFlight = new Map<string, { promise: Promise<void>; abort: AbortController }>();
  private running = false;
  private wake: (() => void) | null = null;
  private listener: pg.PoolClient | null = null;
  private lastScheduleCheck = 0;

  constructor(private readonly options: WorkerOptions) {
    this.definitions = new Map(options.definitions.map((d) => [d.name, d]));
  }

  private get log() {
    return this.options.log;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    this.running = true;
    await this.ensureSchedules();
    await this.listen();
    this.log.info({ workerId: this.id, jobs: [...this.definitions.keys()] }, "Worker started");
    void this.loop();
  }

  /**
   * Graceful shutdown: stop claiming, ask running jobs to stop (AbortSignal),
   * wait for them, and hand back any that didn't finish so another worker can
   * pick them up right away instead of waiting for their lease to expire.
   */
  async stop(timeoutMs = 25_000) {
    this.running = false;
    this.wake?.();
    for (const { abort } of this.inFlight.values()) abort.abort();
    const all = Promise.allSettled([...this.inFlight.values()].map((j) => j.promise));
    await Promise.race([all, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    if (this.inFlight.size > 0) {
      await this.options.db
        .update(jobs)
        .set({ status: "queued", lockedUntil: null, lockedBy: null, runAt: sql`now()` })
        .where(and(inArray(jobs.id, [...this.inFlight.keys()]), eq(jobs.lockedBy, this.id)));
    }
    this.listener?.release();
    this.listener = null;
    this.log.info({ workerId: this.id }, "Worker stopped");
  }

  /**
   * Tests (and scripts) call this: run every job that's ready — including
   * delayed ones if asked — until the queue is empty. Returns what ran.
   */
  async drain({ includeDelayed = false, maxJobs = 1_000 } = {}) {
    const ran: Array<{ name: string; status: string }> = [];
    while (ran.length < maxJobs) {
      const [job] = await this.claim(1, includeDelayed);
      if (!job) break;
      const status = await this.execute(job, new AbortController().signal);
      ran.push({ name: job.name, status });
    }
    return ran;
  }

  // ─── The loop ──────────────────────────────────────────────────────────────

  private async loop() {
    const { concurrency = 4, pollIntervalMs = 1_000 } = this.options;
    while (this.running) {
      try {
        await this.runDueSchedules();
        const free = concurrency - this.inFlight.size;
        const claimed = free > 0 ? await this.claim(free) : [];
        for (const job of claimed) this.spawn(job);
        // Nothing to do (or no free slots): sleep until a NOTIFY, a finished job, or the poll timer.
        if (claimed.length === 0 || this.inFlight.size >= concurrency) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, pollIntervalMs);
            this.wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          this.wake = null;
        }
      } catch (error) {
        // e.g. the database restarted. Back off a little and keep going.
        this.log.error({ err: error }, "Worker loop error");
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }

  private spawn(job: Job) {
    const abort = new AbortController();
    const promise = this.execute(job, abort.signal)
      .then(() => undefined)
      .finally(() => {
        this.inFlight.delete(job.id);
        this.wake?.(); // a slot just freed up
      });
    this.inFlight.set(job.id, { promise, abort });
  }

  /** Claim up to `limit` jobs: ready queued ones, plus running ones whose lease expired. */
  private async claim(limit: number, includeDelayed = false): Promise<Job[]> {
    const ready = includeDelayed ? sql`true` : sql`${jobs.runAt} <= now()`;
    const result = await this.options.db.execute<{ id: string }>(sql`
      update jobs set
        status = 'running',
        attempts = attempts + 1,
        locked_by = ${this.id},
        locked_until = now() + make_interval(secs => ${DEFAULT_LEASE_SECONDS})
      where id in (
        select id from jobs
        where (status = 'queued' and ${ready})
           or (status = 'running' and locked_until < now())
        order by run_at
        limit ${limit}
        for update skip locked
      )
      returning id`);
    if (result.rows.length === 0) return [];
    // Re-read through Drizzle so columns come back typed (dates as Date, etc.).
    const claimed = await this.options.db
      .select()
      .from(jobs)
      .where(
        inArray(
          jobs.id,
          result.rows.map((r) => r.id),
        ),
      );
    // Per-definition lease length.
    for (const job of claimed) {
      const lease = this.definitions.get(job.name)?.leaseSeconds;
      if (lease && lease !== DEFAULT_LEASE_SECONDS) await this.renewLease(job.id, lease);
    }
    return claimed;
  }

  private renewLease(jobId: string, seconds: number) {
    return this.options.db
      .update(jobs)
      .set({ lockedUntil: sql`now() + make_interval(secs => ${seconds})` })
      .where(and(eq(jobs.id, jobId), eq(jobs.lockedBy, this.id)));
  }

  // ─── Running one job ───────────────────────────────────────────────────────

  private async execute(job: Job, signal: AbortSignal): Promise<"succeeded" | "retry" | "failed"> {
    const log = this.log.child({ jobId: job.id, job: job.name, attempt: job.attempts });
    const definition = this.definitions.get(job.name);
    const maxAttempts = job.maxAttempts ?? definition?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const lease = definition?.leaseSeconds ?? DEFAULT_LEASE_SECONDS;

    // Heartbeat: renew the lease at a third of its length while the handler runs.
    const heartbeat = setInterval(
      () => void this.renewLease(job.id, lease).catch(() => {}),
      (lease * 1000) / 3,
    );
    const started = performance.now();
    try {
      if (!definition) throw new PermanentJobError(`No handler for job "${job.name}"`);
      if (job.attempts > maxAttempts) {
        throw new PermanentJobError("Gave up: the job kept losing its lease (worker crashes?)");
      }
      const parsed = definition.payload.safeParse(job.payload);
      if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`);

      await definition.run(parsed.data, {
        db: this.options.db,
        log,
        job,
        mailer: this.options.mailer,
        signal,
      });

      await this.finish(job, { status: "succeeded", finishedAt: sql`now()` });
      log.info({ ms: Math.round(performance.now() - started) }, "Job succeeded");
      return "succeeded";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof PermanentJobError;
      if (!permanent && job.attempts < maxAttempts) {
        const delay = backoffMs(job.attempts);
        await this.finish(job, {
          status: "queued",
          lastError: message,
          runAt: sql`now() + make_interval(secs => ${delay / 1000})`,
        });
        log.warn({ err: error, retryInMs: delay }, "Job failed; will retry");
        return "retry";
      }
      await this.finish(job, { status: "failed", lastError: message, finishedAt: sql`now()` });
      log.error({ err: error }, "Job failed permanently");
      return "failed";
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Only the lease holder may record the outcome — a worker that lost its lease must not overwrite the new owner's. */
  private async finish(job: Job, set: Partial<Record<keyof Job, unknown>>) {
    const updated = await this.options.db
      .update(jobs)
      .set({ ...set, lockedUntil: null, lockedBy: null } as never)
      .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, this.id)))
      .returning({ id: jobs.id });
    if (updated.length === 0) {
      this.log.warn(
        { jobId: job.id },
        "Lost the lease before finishing; another worker owns this job now",
      );
    }
  }

  // ─── LISTEN / NOTIFY ───────────────────────────────────────────────────────

  private async listen() {
    if (!this.options.pool) return;
    try {
      this.listener = await this.options.pool.connect();
      this.listener.on("notification", () => this.wake?.());
      this.listener.on("error", (error) => {
        this.log.warn({ err: error }, "LISTEN connection lost; polling until it reconnects");
        this.listener = null;
        setTimeout(() => this.running && void this.listen(), 5_000);
      });
      await this.listener.query(`LISTEN ${JOBS_CHANNEL}`);
    } catch (error) {
      this.log.warn({ err: error }, "Could not LISTEN; falling back to polling");
    }
  }

  // ─── Schedules ─────────────────────────────────────────────────────────────

  async ensureSchedules() {
    for (const schedule of this.options.schedules ?? []) {
      await this.options.db
        .insert(jobSchedules)
        .values({
          name: schedule.job,
          intervalSeconds: schedule.everySeconds,
          nextRunAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: jobSchedules.name,
          set: { intervalSeconds: schedule.everySeconds },
        });
    }
  }

  /**
   * Every few seconds: atomically move each due schedule's next_run_at forward
   * and enqueue its job, in ONE transaction. With many workers, only the one
   * whose UPDATE matched the row enqueues — the others see next_run_at already
   * in the future. No leader election, no double runs.
   */
  async runDueSchedules() {
    const schedules = this.options.schedules ?? [];
    if (schedules.length === 0 || Date.now() - this.lastScheduleCheck < 5_000) return;
    this.lastScheduleCheck = Date.now();
    if (Math.random() < 0.02) await this.ensureSchedules(); // recreate if someone wiped the table

    await this.options.db.transaction(async (tx) => {
      const due = await tx
        .update(jobSchedules)
        .set({
          nextRunAt: sql`now() + make_interval(secs => ${jobSchedules.intervalSeconds})`,
          lastRunAt: sql`now()`,
        })
        .where(sql`${jobSchedules.nextRunAt} <= now()`)
        .returning({ name: jobSchedules.name });
      for (const { name } of due) {
        const schedule = schedules.find((s) => s.job === name);
        if (schedule)
          await enqueue(tx, name, schedule.payload, { singletonKey: `schedule:${name}` });
      }
    });
  }
}
