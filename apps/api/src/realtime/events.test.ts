import { eq, notifications, sessions, users } from "@ledgerly/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  OUTSIDER,
  OWNER,
  SESSION_COOKIE,
  VIEWER,
  request,
  tokenOf,
  useTestApp,
} from "../test/helpers.js";

interface Stream {
  events: Array<{ event: string; data: Record<string, unknown> }>;
  next: (
    match: (e: { event: string; data: Record<string, unknown> }) => boolean,
    timeoutMs?: number,
  ) => Promise<{ event: string; data: Record<string, unknown> }>;
  close: () => void;
  closed: Promise<void>;
}

describe("live events (Server-Sent Events)", () => {
  const ctx = useTestApp({ REALTIME_HEARTBEAT_MS: "300" }, { realtime: true });
  const open: Stream[] = [];
  afterEach(() => open.splice(0).forEach((s) => s.close()));

  /** A tiny SSE client: reads the stream and parses "event:" / "data:" frames. */
  async function connect(email: string): Promise<Stream> {
    const abort = new AbortController();
    const response = await fetch(`${ctx.baseUrl}/v1/events`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokenOf(email)}` },
      signal: abort.signal,
    });
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    const stream: Stream = {
      events: [],
      next: (match, timeoutMs = 3_000) =>
        new Promise((resolve, reject) => {
          const started = Date.now();
          const check = () => {
            const found = stream.events.find(match);
            if (found) return resolve(found);
            if (Date.now() - started > timeoutMs)
              return reject(new Error("Timed out waiting for event"));
            setTimeout(check, 20);
          };
          check();
        }),
      close: () => abort.abort(),
      closed: Promise.resolve(),
    };
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    stream.closed = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (data) stream.events.push({ event, data: JSON.parse(data) });
          }
        }
      } catch {
        // aborted
      }
    })();
    open.push(stream);
    await stream.next((e) => e.event === "ready");
    return stream;
  }

  const createTransaction = async (user = OWNER) => {
    const accounts = (
      await request(ctx.app, user, {
        method: "GET",
        url: `/v1/households/${ctx.fixtures.householdId}/accounts`,
      })
    ).json().data;
    return request(ctx.app, user, {
      method: "POST",
      url: `/v1/households/${ctx.fixtures.householdId}/transactions`,
      payload: {
        accountId: accounts[0].id,
        amountMinor: -450,
        occurredOn: "2026-06-14",
        description: "Coffee",
      },
    });
  };
  const userId = async (email: string) =>
    (await ctx.db.select().from(users).where(eq(users.email, email)))[0]!.id;

  it("requires a session", async () => {
    expect((await fetch(`${ctx.baseUrl}/v1/events`)).status).toBe(401);
  });

  it("pushes a change to every member — and to nobody else", async () => {
    const owner = await connect(OWNER);
    const viewer = await connect(VIEWER);
    const outsider = await connect(OUTSIDER);
    expect((await createTransaction()).statusCode).toBe(201);

    const isTx = (e: { data: Record<string, unknown> }) => e.data.type === "transactions";
    const seen = await viewer.next(isTx);
    expect(seen.data).toEqual({
      type: "transactions",
      householdId: ctx.fixtures.householdId,
      op: "insert",
      count: 1,
      actors: [await userId(OWNER)],
    });
    await owner.next(isTx);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(outsider.events.some(isTx)).toBe(false);
  });

  it("delivers notifications to their owner only", async () => {
    const owner = await connect(OWNER);
    const viewer = await connect(VIEWER);
    await ctx.db.insert(notifications).values({
      userId: await userId(VIEWER),
      householdId: ctx.fixtures.householdId,
      kind: "test",
      title: "Hello",
      body: "World",
      dedupeKey: "t1",
    });
    await viewer.next((e) => e.data.type === "notifications");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(owner.events.some((e) => e.data.type === "notifications")).toBe(false);
  });

  it("shows who's online, and when they leave", async () => {
    const owner = await connect(OWNER);
    const viewer = await connect(VIEWER);
    const viewerId = await userId(VIEWER);
    await owner.next(
      (e) => e.data.type === "presence" && e.data.userId === viewerId && e.data.online === true,
    );
    viewer.close();
    await owner.next(
      (e) => e.data.type === "presence" && e.data.userId === viewerId && e.data.online === false,
    );
  });

  it("stops a removed member's stream from seeing the household", async () => {
    const viewer = await connect(VIEWER);
    const viewerId = await userId(VIEWER);
    await request(ctx.app, OWNER, {
      method: "DELETE",
      url: `/v1/households/${ctx.fixtures.householdId}/members/${viewerId}`,
    });
    await viewer.next((e) => e.data.type === "membership");
    await createTransaction();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(viewer.events.some((e) => e.data.type === "transactions")).toBe(false);
  });

  it("ends the stream when the session is revoked", async () => {
    const viewer = await connect(VIEWER);
    await ctx.db.delete(sessions).where(eq(sessions.userId, await userId(VIEWER)));
    await viewer.next((e) => e.event === "unauthorized", 2_000);
    await viewer.closed; // the server ended the response
  });

  it("caps connections per user", async () => {
    for (let i = 0; i < 10; i++) await connect(OUTSIDER);
    const eleventh = await fetch(`${ctx.baseUrl}/v1/events`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokenOf(OUTSIDER)}` },
    });
    expect(eleventh.status).toBe(429);
  });
});
