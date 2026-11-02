import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyContextConfig {
    /**
     * Cache this GET's response per household data version. Only for routes
     * whose answer is the same for every member and depends only on the
     * household's data and the URL.
     */
    cache?: boolean;
  }
  interface FastifyRequest {
    cacheKey?: string;
  }
}

/** A small least-recently-used cache: a Map keeps insertion order, so the first key is the oldest. */
export class LruCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  hits = 0;
  misses = 0;
  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      if (entry) this.entries.delete(key);
      this.misses++;
      return undefined;
    }
    this.entries.delete(key); // re-insert = mark as most recently used
    this.entries.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: V) {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }

  get size() {
    return this.entries.size;
  }
}

/**
 * Response cache + ETags for expensive household reads (Stage 12).
 *
 *   key  = household · data version · today (UTC) · URL
 *   ETag = hash of the key
 *
 * Correct by construction: a write bumps the version (database trigger, same
 * transaction), so the NEXT request computes a different key — there is no
 * "remember to delete the cache entry" step to forget, and every API instance
 * agrees immediately because the version comes from the database.
 *
 * Two savings: a cache HIT skips the queries; a matching If-None-Match skips
 * the body too (304 Not Modified — the browser reuses its copy).
 */
export const responseCachePlugin = fp(
  async (app: FastifyInstance, opts: { maxEntries: number; ttlMs: number }) => {
    const cache = new LruCache<string>(opts.maxEntries, opts.ttlMs);
    app.decorate("responseCache", cache);

    app.addHook("preHandler", async (request, reply) => {
      if (opts.maxEntries === 0 || request.method !== "GET" || !request.routeOptions.config.cache)
        return;
      const household = request.household;
      if (!household) return;

      const key = `${household.id}:${household.dataVersion}:${new Date().toISOString().slice(0, 10)}:${request.url}`;
      const etag = `"${createHash("sha1").update(key).digest("base64url").slice(0, 16)}"`;
      // private: only the user's browser may store it (never a shared proxy);
      // no-cache: store it, but always ask us first (we answer 304 when unchanged).
      reply
        .header("etag", etag)
        .header("cache-control", "private, no-cache")
        .header("vary", "cookie");

      if (request.headers["if-none-match"] === etag) {
        return reply.code(304).send();
      }
      const hit = cache.get(key);
      if (hit !== undefined) {
        return reply.header("x-cache", "hit").type("application/json; charset=utf-8").send(hit);
      }
      request.cacheKey = key;
      reply.header("x-cache", "miss");
    });

    app.addHook("onSend", async (request, reply, payload) => {
      if (request.cacheKey && reply.statusCode === 200 && typeof payload === "string") {
        cache.set(request.cacheKey, payload);
      }
      return payload;
    });
  },
  { name: "response-cache" },
);

declare module "fastify" {
  interface FastifyInstance {
    responseCache: LruCache<string>;
  }
}
