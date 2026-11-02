import { randomUUID } from "node:crypto";
import { and, eq, gt, householdMembers, sessions, sql } from "@ledgerly/db";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type pg from "pg";
import { AppError } from "../lib/errors.js";
import { EVENTS_CHANNEL, RealtimeHub, type ClientEvent, type Subscriber } from "./hub.js";

declare module "fastify" {
  interface FastifyInstance {
    realtime: RealtimeHub;
  }
}

/** One person, a handful of tabs and devices. More is a bug or abuse. */
const MAX_CONNECTIONS_PER_USER = 10;
/** A client that can't keep up gets disconnected (it will reconnect and resync). */
const MAX_BUFFERED_BYTES = 1_000_000;

/**
 * GET /v1/events — a Server-Sent Events stream of "something changed" messages.
 *
 * Why SSE and not WebSockets? Updates only flow server → browser (browsers
 * still change data with normal HTTP requests). SSE is plain HTTP: it goes
 * through our Next.js proxy, cookies authenticate it, and the browser's
 * EventSource reconnects automatically. WebSockets earn their extra complexity
 * when the CLIENT streams too (games, collaborative cursors).
 */
export const realtimePlugin = fp(
  async (app: FastifyInstance, opts: { pool: pg.Pool; heartbeatMs: number }) => {
    const hub = new RealtimeHub(opts.pool, app.log);
    app.decorate("realtime", hub);
    await hub.start();
    const sweeper = setInterval(() => hub.sweep(), 15_000);

    const announce = (message: object) =>
      app.db.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(message)})`);

    const closers = new Set<() => void>();

    app.get(
      "/v1/events",
      {
        onRequest: app.authenticate,
        schema: {
          tags: ["Realtime"],
          summary: "Server-Sent Events: live change notifications",
          hide: false,
        },
      },
      async (request, reply) => {
        const user = request.user!;
        if (hub.connectionsOf(user.id) >= MAX_CONNECTIONS_PER_USER) {
          throw new AppError(429, "too_many_connections", "Too many live connections");
        }

        const loadHouseholds = async () =>
          new Set(
            (
              await app.db
                .select({ id: householdMembers.householdId })
                .from(householdMembers)
                .where(eq(householdMembers.userId, user.id))
            ).map((m) => m.id),
          );

        const connectionId = randomUUID();
        const subscriber: Subscriber = {
          id: connectionId,
          userId: user.id,
          households: await loadHouseholds(),
          send: (event: ClientEvent) => write(`data: ${JSON.stringify(event)}\n\n`),
          refreshHouseholds: async () => {
            subscriber.households = await loadHouseholds();
          },
        };

        // From here on we write the HTTP response ourselves, for as long as it stays open.
        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform", // never cache, never compress (it would buffer)
          connection: "keep-alive",
          "x-accel-buffering": "no", // tells nginx-style proxies not to buffer
        });

        let closed = false;
        const timers: { heartbeat?: NodeJS.Timeout } = {};
        const write = (chunk: string) => {
          if (closed) return;
          if (raw.writableLength > MAX_BUFFERED_BYTES) return close();
          raw.write(chunk);
        };

        const presence = (s: "online" | "offline") =>
          announce({
            t: "presence",
            u: user.id,
            c: connectionId,
            hs: [...subscriber.households],
            s,
          }).catch(() => {});

        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(timers.heartbeat);
          removeSubscriber();
          closers.delete(close);
          void presence("offline");
          raw.end();
        };

        const removeSubscriber = hub.add(subscriber);
        closers.add(close);
        request.raw.on("close", close);

        // `retry:` tells EventSource how long to wait before reconnecting.
        write("retry: 3000\n\n");
        const online: Record<string, string[]> = {};
        for (const householdId of subscriber.households)
          online[householdId] = hub.onlineIn(householdId);
        write(`event: ready\ndata: ${JSON.stringify({ connectionId, online })}\n\n`);
        void presence("online");

        timers.heartbeat = setInterval(async () => {
          // A comment line keeps proxies from closing an idle connection.
          write(": ping\n\n");
          // Sessions can be revoked ("sign out everywhere"). A stream must not outlive its session.
          const [stillValid] = await app.db
            .select({ id: sessions.id })
            .from(sessions)
            .where(and(eq(sessions.id, request.session!.id), gt(sessions.expiresAt, sql`now()`)))
            .catch(() => [{ id: "assume-valid-on-db-error" }]);
          if (!stillValid) {
            write(`event: unauthorized\ndata: {}\n\n`);
            return close();
          }
          void presence("online"); // presence heartbeat (entries expire after 60 s)
        }, opts.heartbeatMs);
      },
    );

    // Deploys: end every stream BEFORE the server closes, or it would wait for
    // them forever. Browsers reconnect — to a new instance — within seconds.
    app.addHook("preClose", async () => {
      for (const close of [...closers]) close();
    });
    app.addHook("onClose", async () => {
      clearInterval(sweeper);
      await hub.stop();
    });
  },
  { name: "realtime", dependencies: ["auth"] },
);
