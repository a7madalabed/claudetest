import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { FastifyBaseLogger } from "fastify";

export const EVENTS_CHANNEL = "ledgerly_events";

/** What the database triggers send (see migration 0010) — ids and counts, never data. */
export interface ChangeMessage {
  t: string; // table, or "presence" / "notifications"
  op?: string;
  h?: string; // household id
  u?: string | string[]; // user id(s)
  n?: number; // rows changed
  a?: string[]; // actor user ids (transactions)
  c?: string; // connection id (presence)
  hs?: string[]; // households (presence)
  s?: "online" | "offline";
}

/** What browsers receive. */
export interface ClientEvent {
  type: string;
  householdId?: string;
  op?: string;
  count?: number;
  actors?: string[];
  users?: string[];
  userId?: string;
  online?: boolean;
}

export interface Subscriber {
  id: string;
  userId: string;
  households: Set<string>;
  send: (event: ClientEvent) => void;
  /** Re-read memberships from the database (joined or left a household). */
  refreshHouseholds: () => Promise<void>;
}

/** Presence entries expire if not refreshed by a heartbeat within this window. */
export const PRESENCE_TTL_MS = 60_000;

/**
 * One per API process. It holds ONE Postgres connection doing
 * `LISTEN ledgerly_events`, and fans each message out to the browsers
 * connected to THIS process that are allowed to see it.
 *
 * Why this scales: 5,000 open browser tabs cost 5,000 idle sockets (cheap) but
 * still ONE database connection per process. And because every API instance
 * listens to the same Postgres channel, a change made through instance A
 * reaches browsers connected to instance B — no sticky sessions, no extra
 * message broker.
 */
export class RealtimeHub {
  readonly instanceId = randomUUID().slice(0, 8);
  private readonly subscribers = new Set<Subscriber>();
  /** connection id → presence. Built from the SHARED event stream, so every instance agrees. */
  private readonly presence = new Map<
    string,
    { userId: string; households: string[]; seenAt: number }
  >();
  private client: pg.PoolClient | null = null;
  private stopped = false;

  constructor(
    private readonly pool: pg.Pool,
    private readonly log: FastifyBaseLogger,
  ) {}

  async start() {
    this.stopped = false;
    await this.connect();
  }

  private async connect() {
    try {
      const client = await this.pool.connect();
      client.on("notification", (message) => {
        if (message.channel !== EVENTS_CHANNEL || !message.payload) return;
        try {
          this.dispatch(JSON.parse(message.payload) as ChangeMessage);
        } catch (error) {
          this.log.warn({ err: error }, "Unreadable realtime message");
        }
      });
      client.on("error", (error) => {
        this.log.warn({ err: error }, "Realtime LISTEN connection lost; reconnecting");
        this.client = null;
        client.release(true);
        if (!this.stopped) setTimeout(() => void this.reconnect(), 1_000);
      });
      await client.query(`LISTEN ${EVENTS_CHANNEL}`);
      this.client = client;
    } catch (error) {
      this.log.error({ err: error }, "Realtime could not LISTEN; retrying in 5 s");
      if (!this.stopped) setTimeout(() => void this.reconnect(), 5_000);
    }
  }

  /**
   * Messages sent while we weren't listening are LOST (NOTIFY doesn't queue for
   * absent listeners). So after reconnecting, tell every browser to resync —
   * refetch what it shows. Correctness never depends on receiving every event.
   */
  private async reconnect() {
    await this.connect();
    if (this.client) for (const s of this.subscribers) s.send({ type: "resync" });
  }

  async stop() {
    this.stopped = true;
    this.client?.release();
    this.client = null;
  }

  get size() {
    return this.subscribers.size;
  }

  connectionsOf(userId: string) {
    return [...this.subscribers].filter((s) => s.userId === userId).length;
  }

  add(subscriber: Subscriber) {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** Who's online in these households right now (from every instance's heartbeats). */
  onlineIn(householdId: string, now = Date.now()) {
    const users = new Set<string>();
    for (const entry of this.presence.values()) {
      if (now - entry.seenAt < PRESENCE_TTL_MS && entry.households.includes(householdId)) {
        users.add(entry.userId);
      }
    }
    return [...users];
  }

  /** Route one database message to the subscribers allowed to see it. */
  dispatch(message: ChangeMessage, now = Date.now()) {
    const users = message.u === undefined ? [] : Array.isArray(message.u) ? message.u : [message.u];

    switch (message.t) {
      case "notifications": {
        for (const s of this.subscribers)
          if (users.includes(s.userId)) s.send({ type: "notifications" });
        return;
      }

      case "presence": {
        if (!message.c || users.length === 0) return;
        const userId = users[0]!;
        // An entry being removed counts as "was online" even if it already expired
        // (that's exactly the sweep case: a crashed instance's users go offline).
        const before =
          this.isOnlineAnywhere(userId, now) ||
          (message.s === "offline" && this.presence.has(message.c));
        if (message.s === "offline") this.presence.delete(message.c);
        else this.presence.set(message.c, { userId, households: message.hs ?? [], seenAt: now });
        const after = this.isOnlineAnywhere(userId, now);
        if (before === after) return; // a heartbeat or a second tab: nothing new to say
        for (const householdId of message.hs ?? []) {
          for (const s of this.subscribers) {
            if (s.households.has(householdId) && s.userId !== userId) {
              s.send({ type: "presence", householdId, userId, online: after });
            }
          }
        }
        return;
      }

      case "household_members": {
        // Members whose membership changed re-read theirs FIRST — a removed member
        // must stop receiving this household's events, a new one must start.
        for (const s of this.subscribers) {
          if (users.includes(s.userId)) {
            void s
              .refreshHouseholds()
              .then(() => s.send({ type: "membership", householdId: message.h, users }));
          } else if (message.h && s.households.has(message.h)) {
            s.send({ type: "household_members", householdId: message.h, op: message.op, users });
          }
        }
        return;
      }

      default: {
        if (!message.h) return;
        const event: ClientEvent = {
          type: message.t,
          householdId: message.h,
          op: message.op,
          count: message.n,
          ...(message.a && { actors: message.a }),
        };
        for (const s of this.subscribers) if (s.households.has(message.h)) s.send(event);
      }
    }
  }

  private isOnlineAnywhere(userId: string, now: number) {
    for (const entry of this.presence.values()) {
      if (entry.userId === userId && now - entry.seenAt < PRESENCE_TTL_MS) return true;
    }
    return false;
  }

  /** Forget presence entries whose instance stopped heartbeating (it crashed). */
  sweep(now = Date.now()) {
    for (const [connection, entry] of this.presence) {
      if (now - entry.seenAt >= PRESENCE_TTL_MS) {
        // dispatch() removes the entry and announces "offline" if it was their last one.
        this.dispatch(
          { t: "presence", u: entry.userId, c: connection, hs: entry.households, s: "offline" },
          now,
        );
      }
    }
  }
}
