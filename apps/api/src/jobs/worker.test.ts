import { createDb, eq, jobs, sql } from "@ledgerly/db";
import { pino } from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MemoryMailer } from "../lib/mailer.js";
import { API_TEST_DATABASE_URL } from "../test/database.js";
import { enqueue } from "./queue.js";
import { PermanentJobError, defineJob, type JobDefinition } from "./registry.js";
import { Worker, backoffMs } from "./worker.js";

const { db, pool, close } = createDb({
  connectionString: API_TEST_DATABASE_URL,
  maxConnections: 6,
});
afterAll(() => close());
beforeEach(() => db.execute(sql`truncate table jobs, job_schedules`));

const log = pino({ level: "silent" });
const worker = (definitions: JobDefinition[], schedules = []) =>
  new Worker({ db, definitions, schedules, mailer: new MemoryMailer(), log });
const jobRow = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;

describe("job queue", () => {
  it("runs a job with its validated payload", async () => {
    const seen: string[] = [];
    const greet = defineJob({
      name: "greet",
      payload: z.object({ name: z.string() }),
      run: async ({ name }) => void seen.push(name),
    });
    const id = await enqueue(db, "greet", { name: "Ada" });
    expect(await worker([greet]).drain()).toEqual([{ name: "greet", status: "succeeded" }]);
    expect(seen).toEqual(["Ada"]);
    expect(await jobRow(id!)).toMatchObject({ status: "succeeded", attempts: 1, lockedBy: null });
  });

  it("retries with backoff, then succeeds", async () => {
    let calls = 0;
    const flaky = defineJob({
      name: "flaky",
      payload: z.object({}),
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error("network blip");
      },
    });
    const id = await enqueue(db, "flaky");
    const w = worker([flaky]);
    expect(await w.drain()).toEqual([{ name: "flaky", status: "retry" }]);
    const waiting = await jobRow(id!);
    expect(waiting).toMatchObject({ status: "queued", attempts: 1, lastError: "network blip" });
    expect(waiting.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(await w.drain()).toEqual([]); // not due yet
    expect(await w.drain({ includeDelayed: true })).toEqual([
      { name: "flaky", status: "succeeded" },
    ]);
  });

  it("stops after maxAttempts, and immediately on a permanent error", async () => {
    const broken = defineJob({
      name: "broken",
      payload: z.object({}),
      maxAttempts: 2,
      run: async () => {
        throw new Error("always");
      },
    });
    const doomed = defineJob({
      name: "doomed",
      payload: z.object({}),
      run: async () => {
        throw new PermanentJobError("bad input");
      },
    });
    const a = await enqueue(db, "broken");
    const b = await enqueue(db, "doomed");
    const ran = await worker([broken, doomed]).drain({ includeDelayed: true });
    expect(ran.map((r) => `${r.name}:${r.status}`)).toEqual([
      "broken:retry",
      "doomed:failed",
      "broken:failed",
    ]);
    expect(await jobRow(a!)).toMatchObject({ status: "failed", attempts: 2 });
    expect(await jobRow(b!)).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "bad input",
    });
  });

  it("fails jobs with an unknown name or an invalid payload without retrying", async () => {
    const typed = defineJob({
      name: "typed",
      payload: z.object({ n: z.number() }),
      run: async () => {},
    });
    await enqueue(db, "nobody-handles-this");
    await enqueue(db, "typed", { n: "not a number" });
    const ran = await worker([typed]).drain();
    expect(ran.every((r) => r.status === "failed")).toBe(true);
  });

  it("coalesces jobs with the same singleton key while one is queued", async () => {
    const first = await enqueue(db, "x", {}, { singletonKey: "k" });
    const second = await enqueue(db, "x", {}, { singletonKey: "k" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("a retry that finds an identical job already queued hands the work to it (Stage 16)", async () => {
    // While a singleton job RUNS, an identical one may be queued (the unique
    // index only covers queued jobs). If the running one then fails and asks
    // to be queued again, there would be two — which the database refuses.
    // That used to escape as an unhandled error and crash the worker.
    let twin: string | null = null;
    const evaluate = defineJob({
      name: "evaluate",
      payload: z.object({}),
      run: async () => {
        if (twin === null) {
          twin = await enqueue(db, "evaluate", {}, { singletonKey: "k" });
          throw new Error("statement timeout");
        }
      },
    });
    const first = await enqueue(db, "evaluate", {}, { singletonKey: "k" });
    const w = worker([evaluate]);

    expect(await w.drain()).toEqual([
      { name: "evaluate", status: "retry" },
      // The queued twin is due no later than the retry would have been, and runs.
      { name: "evaluate", status: "succeeded" },
    ]);
    expect(twin).not.toBeNull();
    expect(await jobRow(first!)).toMatchObject({
      status: "failed",
      lockedBy: null,
      lastError: expect.stringContaining(`handed over to job ${twin}`),
    });
    expect(await jobRow(twin!)).toMatchObject({ status: "succeeded" });
  });

  it("enqueues atomically with the surrounding transaction", async () => {
    await db
      .transaction(async (tx) => {
        await enqueue(tx, "x");
        throw new Error("roll back");
      })
      .catch(() => {});
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it("never gives the same job to two workers (SKIP LOCKED)", async () => {
    const runs = new Map<number, number>();
    const count = defineJob({
      name: "count",
      payload: z.object({ i: z.number() }),
      run: async ({ i }) => {
        runs.set(i, (runs.get(i) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
    });
    for (let i = 0; i < 30; i++) await enqueue(db, "count", { i });
    const results = await Promise.all([
      worker([count]).drain(),
      worker([count]).drain(),
      worker([count]).drain(),
    ]);
    expect(results.flat()).toHaveLength(30);
    expect([...runs.values()].every((n) => n === 1)).toBe(true);
    expect(results.filter((r) => r.length > 0).length).toBeGreaterThan(1); // the work was shared
  });

  it("takes over a job whose worker died (expired lease)", async () => {
    const ok = defineJob({ name: "ok", payload: z.object({}), run: async () => {} });
    const id = await enqueue(db, "ok");
    await db
      .update(jobs)
      .set({
        status: "running",
        attempts: 1,
        lockedBy: "dead-worker",
        lockedUntil: sql`now() - interval '1 second'`,
      })
      .where(eq(jobs.id, id!));
    expect(await worker([ok]).drain()).toEqual([{ name: "ok", status: "succeeded" }]);
    expect(await jobRow(id!)).toMatchObject({ status: "succeeded", attempts: 2 });
  });

  it("enqueues each schedule tick exactly once, even with several workers", async () => {
    const schedules = [{ job: "tick", everySeconds: 60 }];
    const workers = [0, 1, 2].map(
      () => new Worker({ db, definitions: [], schedules, mailer: new MemoryMailer(), log }),
    );
    await workers[0]!.ensureSchedules();
    await Promise.all(workers.map((w) => w.runDueSchedules()));
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("reports every attempt's outcome and duration (for metrics)", async () => {
    const seen: Array<[string, string, number]> = [];
    const ok = defineJob({ name: "ok", payload: z.object({}), run: async () => {} });
    const bad = defineJob({
      name: "bad",
      payload: z.object({}),
      run: async () => {
        throw new PermanentJobError("nope");
      },
    });
    await enqueue(db, "ok");
    await enqueue(db, "bad");
    await new Worker({
      db,
      definitions: [ok, bad],
      mailer: new MemoryMailer(),
      log,
      onJobFinished: (job, outcome, seconds) => seen.push([job, outcome, seconds]),
    }).drain();
    expect(seen.map(([job, outcome]) => `${job}:${outcome}`).sort()).toEqual([
      "bad:failed",
      "ok:succeeded",
    ]);
    expect(seen.every(([, , seconds]) => seconds >= 0 && seconds < 5)).toBe(true);
  });

  it("backs off exponentially, with jitter, up to an hour", () => {
    const mid = () => 0.5; // jitter factor 1.0
    expect([1, 2, 3, 4].map((n) => backoffMs(n, mid))).toEqual([10_000, 20_000, 40_000, 80_000]);
    expect(backoffMs(30, mid)).toBe(3_600_000);
    expect(backoffMs(1, () => 0)).toBe(5_000);
  });
});

/**
 * The tests above call drain(), which runs jobs one by one on the test's own
 * schedule. These exercise the real thing — start(), the loop, LISTEN and
 * stop() — because that is the code production actually runs.
 */
describe("worker loop", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };
  const within = <T>(promise: Promise<T>, ms: number) =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`not done within ${ms} ms`)), ms),
      ),
    ]);

  it("wakes on NOTIFY instead of waiting for the next poll", async () => {
    const ran = deferred();
    const ping = defineJob({ name: "ping", payload: z.object({}), run: async () => ran.resolve() });
    // A one-minute poll: if the job runs in under two seconds, LISTEN woke the worker.
    const w = new Worker({
      db,
      pool,
      definitions: [ping],
      mailer: new MemoryMailer(),
      log,
      pollIntervalMs: 60_000,
    });
    await w.start();
    try {
      await enqueue(db, "ping");
      await within(ran.promise, 2_000);
    } finally {
      await w.stop();
    }
  });

  it("never runs more jobs at once than its concurrency", async () => {
    let running = 0;
    let peak = 0;
    let done = 0;
    const all = deferred();
    const slow = defineJob({
      name: "slow",
      payload: z.object({}),
      run: async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 50));
        running -= 1;
        if (++done === 6) all.resolve();
      },
    });
    for (let i = 0; i < 6; i++) await enqueue(db, "slow");
    const w = new Worker({
      db,
      pool,
      definitions: [slow],
      mailer: new MemoryMailer(),
      log,
      concurrency: 2,
    });
    await w.start();
    try {
      await within(all.promise, 5_000);
    } finally {
      await w.stop();
    }
    expect(peak).toBe(2);
  });

  it("stop() hands unfinished jobs back to the queue, and a late finish can't overwrite that", async () => {
    const started = deferred();
    const release = deferred();
    const stuck = defineJob({
      name: "stuck",
      payload: z.object({}),
      run: async () => {
        started.resolve();
        await release.promise; // ignores the abort signal, like a badly-behaved handler
      },
    });
    const id = await enqueue(db, "stuck");
    const w = new Worker({ db, pool, definitions: [stuck], mailer: new MemoryMailer(), log });
    await w.start();
    await within(started.promise, 2_000);
    await w.stop(100); // gives up waiting after 100 ms

    const handedBack = await jobRow(id!);
    expect(handedBack).toMatchObject({ status: "queued", lockedBy: null, attempts: 1 });
    expect(handedBack.runAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);

    // The handler finally returns. It no longer holds the lease, so its
    // "succeeded" must not clobber the row another worker may now own.
    release.resolve();
    await new Promise((r) => setTimeout(r, 100));
    expect(await jobRow(id!)).toMatchObject({ status: "queued" });
  });

  it("stop() hands back a job even when an identical one is already queued (Stage 16)", async () => {
    const started = deferred();
    const release = deferred();
    const stuck = defineJob({
      name: "stuck",
      payload: z.object({}),
      run: async () => {
        started.resolve();
        await release.promise;
      },
    });
    const first = await enqueue(db, "stuck", {}, { singletonKey: "k" });
    const w = new Worker({ db, pool, definitions: [stuck], mailer: new MemoryMailer(), log });
    await w.start();
    await within(started.promise, 2_000);
    // While it runs, an identical job is queued; it's due in an hour.
    const twin = await enqueue(db, "stuck", {}, { singletonKey: "k", delayMs: 3_600_000 });

    await expect(w.stop(100)).resolves.toBeUndefined();
    release.resolve();

    expect(await jobRow(first!)).toMatchObject({ status: "failed", lockedBy: null });
    // The twin inherits the urgency: it's due now, not in an hour.
    const inherited = await jobRow(twin!);
    expect(inherited.status).toBe("queued");
    expect(inherited.runAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it("a database error while recording an outcome never crashes the worker (Stage 16)", async () => {
    const done = deferred();
    const crashes: unknown[] = [];
    const onCrash = (error: unknown) => crashes.push(error);
    process.on("unhandledRejection", onCrash);
    try {
      const job = defineJob({ name: "unrecordable", payload: z.object({}), run: async () => {} });
      await enqueue(db, "unrecordable");
      // Make every outcome impossible to record: a job may be claimed (→ running)
      // but never leave "running", so both the success and the retry UPDATE fail.
      await db.execute(
        sql`alter table jobs add constraint review_block check (status = 'running') not valid`,
      );
      const w = new Worker({
        db,
        pool,
        definitions: [job],
        mailer: new MemoryMailer(),
        log,
        onJobFinished: () => done.resolve(),
      });
      await w.start();
      await within(done.promise, 3_000);
      await new Promise((r) => setTimeout(r, 50));
      await db.execute(sql`alter table jobs drop constraint review_block`);
      await w.stop(100);
      expect(crashes).toEqual([]);
    } finally {
      process.off("unhandledRejection", onCrash);
      await db.execute(sql`alter table jobs drop constraint if exists review_block`);
    }
  });

  it("a job whose lease was taken over is told to stop (Stage 17)", async () => {
    // A worker whose heartbeats stalled (a long GC pause, a network blip) can
    // find that another worker has taken its job over. Two copies of the same
    // job must not keep running side by side.
    const started = deferred();
    const stopped = deferred();
    const slow = defineJob({
      name: "slow",
      payload: z.object({}),
      leaseSeconds: 3, // heartbeat every second
      run: async (_payload, { signal }) => {
        started.resolve();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        stopped.resolve();
      },
    });
    const id = await enqueue(db, "slow");
    const w = new Worker({ db, pool, definitions: [slow], mailer: new MemoryMailer(), log });
    await w.start();
    try {
      await within(started.promise, 2_000);
      // Another worker takes the job over.
      await db.update(jobs).set({ lockedBy: "another-worker" }).where(eq(jobs.id, id!));
      await within(stopped.promise, 3_000);
      // …and the new owner's claim is left alone.
      expect(await jobRow(id!)).toMatchObject({ status: "running", lockedBy: "another-worker" });
    } finally {
      await w.stop(100);
    }
  });

  it("asks running jobs to stop via their AbortSignal", async () => {
    const started = deferred();
    let aborted = false;
    const polite = defineJob({
      name: "polite",
      payload: z.object({}),
      run: async (_payload, { signal }) => {
        started.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          }),
        );
      },
    });
    await enqueue(db, "polite");
    const w = new Worker({ db, pool, definitions: [polite], mailer: new MemoryMailer(), log });
    await w.start();
    await within(started.promise, 2_000);
    const before = performance.now();
    await w.stop();
    expect(aborted).toBe(true);
    expect(performance.now() - before).toBeLessThan(1_000); // didn't sit out the 25 s timeout
  });
});
