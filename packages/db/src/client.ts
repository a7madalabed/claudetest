import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface CreateDbOptions {
  connectionString: string;
  /** Max connections in this process's pool. See doc §8.2 for how to size it. */
  maxConnections?: number;
  /** Shows up in pg_stat_activity, so you can tell which service a query came from. */
  applicationName?: string;
  /** Postgres cancels any single query that runs longer than this. */
  statementTimeoutMs?: number;
}

/**
 * Creates a connection POOL and a Drizzle instance on top of it.
 *
 * Opening a Postgres connection is expensive (a new server process, TLS, auth),
 * so we keep a small set of connections open and reuse them across requests.
 * Every timeout here is a guard rail: without them, one slow query or a network
 * blip can make requests hang forever and exhaust the pool.
 */
export function createDb({
  connectionString,
  maxConnections = 10,
  applicationName = "ledgerly",
  statementTimeoutMs = 10_000,
}: CreateDbOptions) {
  const pool = new pg.Pool({
    connectionString,
    max: maxConnections,
    application_name: applicationName,
    statement_timeout: statementTimeoutMs,
    connectionTimeoutMillis: 5_000, // give up waiting for a free connection after 5 s
    idleTimeoutMillis: 30_000, // close connections idle for 30 s
    /*
     * JIT OFF (Stage 12). Postgres can compile a query to machine code when it
     * ESTIMATES the query is expensive. For our short web-request queries the
     * estimate was badly wrong (it assumed generate_series returns 1,000 rows),
     * so it spent ~300 ms compiling queries that run in 0.3–27 ms. JIT helps
     * long analytical queries; an OLTP app is better off without it.
     * Set per connection, so it works on managed databases too.
     */
    options: "-c jit=off",
  });

  const db: Database = drizzle({ client: pool, schema });

  return {
    db,
    pool,
    /** Close all connections — call on graceful shutdown. */
    close: () => pool.end(),
  };
}

/** A transaction handle, as passed to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Anything that can run queries: the pool-backed database OR a transaction.
 * Services accept this so callers decide whether work joins a larger transaction.
 */
export type DbExecutor = Database | DbTransaction;
