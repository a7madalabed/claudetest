import { createDb, eq, jobs, sql } from "@ledgerly/db";
import { pino } from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MemoryMailer } from "../lib/mailer.js";
import { API_TEST_DATABASE_URL } from "../test/database.js";
import { enqueue } from "./queue.js";
import { PermanentJobError, defineJob, type JobDefinition } from "./registry.js";
import { Worker, backoffMs } from "./worker.js";

const { db, close } = createDb({ connectionString: API_TEST_DATABASE_URL, maxConnections: 6 });
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

  it("backs off exponentially, with jitter, up to an hour", () => {
    const mid = () => 0.5; // jitter factor 1.0
    expect([1, 2, 3, 4].map((n) => backoffMs(n, mid))).toEqual([10_000, 20_000, 40_000, 80_000]);
    expect(backoffMs(30, mid)).toBe(3_600_000);
    expect(backoffMs(1, () => 0)).toBe(5_000);
  });
});
