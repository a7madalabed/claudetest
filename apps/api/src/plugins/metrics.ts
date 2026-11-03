import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type pg from "pg";
import type { Registry } from "prom-client";
import { counterOnScrape, gaugeOnScrape, httpMetrics } from "../lib/metrics.js";

/**
 * Records every request's duration by ROUTE TEMPLATE ("/v1/households/:householdId/
 * transactions"), method and status, plus a few gauges read at scrape time:
 * database pool usage, live connections, response-cache efficiency.
 */
export const metricsPlugin = fp(
  async (app: FastifyInstance, opts: { registry: Registry; pool?: pg.Pool }) => {
    const { requestDuration } = httpMetrics(opts.registry);

    app.addHook("onResponse", async (request, reply) => {
      requestDuration.observe(
        {
          method: request.method,
          // The template, never the raw URL: ids in labels would create a new
          // time series per household — unbounded cardinality.
          route: request.routeOptions.url ?? "unmatched",
          status_code: String(reply.statusCode),
        },
        reply.elapsedTime / 1000,
      );
    });

    if (opts.pool) {
      const pool = opts.pool;
      gaugeOnScrape(
        opts.registry,
        "ledgerly_db_pool_connections",
        "Open database connections in this process's pool",
        () => pool.totalCount,
      );
      // Requests waiting for a free connection: above 0 for long = pool too small
      // (or queries too slow). One of the earliest signs of trouble.
      gaugeOnScrape(
        opts.registry,
        "ledgerly_db_pool_waiting",
        "Queries waiting for a free database connection",
        () => pool.waitingCount,
      );
    }

    // Read lazily: these plugins register after this one.
    gaugeOnScrape(
      opts.registry,
      "ledgerly_realtime_connections",
      "Open live-update (SSE) connections",
      () => (app.hasDecorator("realtime") ? app.realtime.size : 0),
    );
    counterOnScrape(
      opts.registry,
      "ledgerly_response_cache_hits_total",
      "Response cache hits",
      () => (app.hasDecorator("responseCache") ? app.responseCache.hits : 0),
    );
    counterOnScrape(
      opts.registry,
      "ledgerly_response_cache_misses_total",
      "Response cache misses",
      () => (app.hasDecorator("responseCache") ? app.responseCache.misses : 0),
    );
  },
  { name: "metrics" },
);
