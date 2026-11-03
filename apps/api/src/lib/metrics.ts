import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/*
 * Prometheus metrics (Stage 14).
 *
 * Prometheus SCRAPES: every 15 s it fetches /metrics from each process and
 * stores the numbers as time series. We expose them on a separate, private
 * port (METRICS_PORT) — never on the public API — because they describe our
 * internals, and a scraper must not count against rate limits or need a login.
 *
 * Naming follows Prometheus conventions: a `ledgerly_` prefix, base units
 * (seconds, bytes), `_total` for counters. Labels must have FEW possible values
 * ("route template", never "URL with ids in it"), or the number of time series
 * explodes ("cardinality") and the metrics system falls over.
 */

/** A fresh registry per process (and per test), instead of prom-client's global one. */
export function createRegistry(service: "api" | "worker", version: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  // CPU, memory, event-loop lag, garbage collection, open handles… for free.
  collectDefaultMetrics({ register: registry, prefix: "ledgerly_" });
  // WHICH build, as one "info" series (value 1) rather than a label on every
  // series: a version label would start a whole new set of series at each
  // deploy. Join it in a query when needed: … * on (instance) group_left(version) ledgerly_build_info
  new Gauge({
    name: "ledgerly_build_info",
    help: "The running build (value is always 1)",
    labelNames: ["version"] as const,
    registers: [registry],
  }).set({ version }, 1);
  return registry;
}

/** HTTP: the "RED" signals — Rate, Errors, Duration — per route. */
export function httpMetrics(registry: Registry) {
  return {
    requestDuration: new Histogram({
      name: "ledgerly_http_request_duration_seconds",
      help: "HTTP request duration, by route template and status code",
      labelNames: ["method", "route", "status_code"] as const,
      // From "instant" to "a user would notice": the buckets our alerts care about.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),
  };
}

/** Jobs: what ran, how it ended, how long it took. */
export function jobMetrics(registry: Registry) {
  return {
    jobDuration: new Histogram({
      name: "ledgerly_job_duration_seconds",
      help: "Background job duration, by job name and outcome",
      // Not "job": Prometheus reserves that label for the scrape target and would
      // silently rename ours to "exported_job".
      labelNames: ["job_name", "outcome"] as const,
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
      registers: [registry],
    }),
    jobsTotal: new Counter({
      name: "ledgerly_jobs_total",
      help: "Background jobs finished, by job name and outcome (succeeded | retry | failed)",
      labelNames: ["job_name", "outcome"] as const,
      registers: [registry],
    }),
  };
}

/** A value read only when Prometheus asks (e.g. pool usage) — nothing to update on hot paths. */
export function gaugeOnScrape(
  registry: Registry,
  name: string,
  help: string,
  read: () => number | Promise<number>,
) {
  return new Gauge({
    name,
    help,
    registers: [registry],
    async collect() {
      this.set(await read());
    },
  });
}

/**
 * A COUNTER (only ever goes up) whose value something else already tracks,
 * e.g. the response cache's hit count. Counters, unlike gauges, let Prometheus
 * compute rates: rate(ledgerly_response_cache_hits_total[5m]).
 */
export function counterOnScrape(
  registry: Registry,
  name: string,
  help: string,
  read: () => number,
) {
  return new Counter({
    name,
    help,
    registers: [registry],
    collect() {
      this.reset();
      this.inc(read());
    },
  });
}

/** Any pino-compatible logger (Fastify's, or a plain pino instance). */
interface Log {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** Serves GET /metrics on its own port. Resolves once listening (port 0 = any free port). */
export async function startMetricsServer(registry: Registry, port: number, log: Log) {
  const server: Server = createServer(async (request, response) => {
    if (request.method !== "GET" || request.url !== "/metrics") {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await registry.metrics();
      response.writeHead(200, { "content-type": registry.contentType }).end(body);
    } catch (error) {
      log.error({ err: error }, "Could not collect metrics");
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "0.0.0.0", resolve));
  const actualPort = (server.address() as AddressInfo).port;
  log.info({ port: actualPort }, "Metrics on /metrics");
  return {
    port: actualPort,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
