import { createDb } from "@ledgerly/db";
import { HealthResponseSchema } from "@ledgerly/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

try {
  process.loadEnvFile();
} catch {
  // CI provides real environment variables.
}

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://ledgerly:ledgerly@localhost:5432/ledgerly_test";

const testEnv = (overrides: Record<string, string> = {}) =>
  loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: TEST_DATABASE_URL, ...overrides });

describe("API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const database = createDb({ connectionString: TEST_DATABASE_URL, maxConnections: 2 });
    app = await buildApp(testEnv(), { db: database.db, closeDb: database.close });
  });

  afterAll(async () => {
    await app.close(); // also closes the pool via the onClose hook
  });

  it("GET /health returns a response matching the shared contract", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    // Validating against the SAME schema the front end uses proves the contract holds.
    const body = HealthResponseSchema.parse(response.json());
    expect(body.status).toBe("ok");
  });

  it("GET /health/ready reports the database as up", async () => {
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      checks: { database: { status: "up" } },
    });
  });

  it("sends security headers", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("tags every response with a request ID for log correlation", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns 404 for unknown routes", async () => {
    const response = await app.inject({ method: "GET", url: "/nope" });
    expect(response.statusCode).toBe(404);
  });
});

describe("readiness when the database is down", () => {
  it("returns 503 but liveness stays 200", async () => {
    // Port 1 is never a Postgres server: every connection attempt fails fast.
    const unreachable = "postgres://ledgerly:ledgerly@127.0.0.1:1/nowhere";
    const database = createDb({ connectionString: unreachable, maxConnections: 1 });
    const app = await buildApp(testEnv({ DATABASE_URL: unreachable }), {
      db: database.db,
      closeDb: database.close,
    });

    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({ status: "unavailable" });

    const live = await app.inject({ method: "GET", url: "/health" });
    expect(live.statusCode).toBe(200);

    await app.close();
  });
});

describe("env", () => {
  it("rejects an invalid port at startup", () => {
    expect(() => testEnv({ PORT: "not-a-number" })).toThrow();
  });

  it("requires a postgres DATABASE_URL", () => {
    expect(() => testEnv({ DATABASE_URL: "mysql://localhost/db" })).toThrow();
  });
});
