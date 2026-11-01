import { createDb } from "@ledgerly/db";
import { HealthResponseSchema, ProblemSchema } from "@ledgerly/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { API_TEST_DATABASE_URL } from "./test/database.js";
import { OWNER, request, useTestApp } from "./test/helpers.js";

const testEnv = (overrides: Record<string, string> = {}) =>
  loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: API_TEST_DATABASE_URL,
    ...overrides,
  });

describe("platform", () => {
  const ctx = useTestApp();

  it("GET /health returns a response matching the shared contract", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).status).toBe("ok");
  });

  it("GET /health/ready reports the database as up", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      checks: { database: { status: "up" } },
    });
  });

  it("sends security headers and a request id", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns unknown routes as RFC 9457 problems", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(ProblemSchema.parse(response.json())).toMatchObject({
      code: "route_not_found",
      status: 404,
    });
  });

  it("rejects malformed JSON with a 400 problem", async () => {
    const me = (await request(ctx.app, OWNER, { method: "GET", url: "/v1/me" })).json();
    const response = await request(ctx.app, OWNER, {
      method: "POST",
      url: `/v1/households/${me.households[0].id}/accounts`,
      headers: { "content-type": "application/json" },
      payload: "{ not json",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().requestId).toBe(response.headers["x-request-id"]);
  });

  it("rejects oversized bodies with 413", async () => {
    const me = (await request(ctx.app, OWNER, { method: "GET", url: "/v1/me" })).json();
    const response = await request(ctx.app, OWNER, {
      method: "POST",
      url: `/v1/households/${me.households[0].id}/accounts`,
      payload: { name: "x".repeat(200_000) },
    });
    expect(response.statusCode).toBe(413);
  });

  it("serves a generated OpenAPI document and interactive docs", async () => {
    const spec = (await ctx.app.inject({ method: "GET", url: "/openapi.json" })).json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toContain("/v1/households/{householdId}/transactions");
    expect(Object.keys(spec.components.schemas)).toEqual(
      expect.arrayContaining(["Account", "Transaction", "Problem", "CreateTransaction"]),
    );
    const docs = await ctx.app.inject({ method: "GET", url: "/docs/" });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers["content-type"]).toContain("text/html");
  });
});

describe("readiness when the database is down", () => {
  it("returns 503 but liveness stays 200", async () => {
    const unreachable = "postgres://ledgerly:ledgerly@127.0.0.1:1/nowhere";
    const database = createDb({ connectionString: unreachable, maxConnections: 1 });
    const app = await buildApp(testEnv({ DATABASE_URL: unreachable }), {
      db: database.db,
      closeDb: database.close,
    });

    expect((await app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(503);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    await app.close();
  });
});

describe("env", () => {
  it("rejects an invalid port", () => {
    expect(() => testEnv({ PORT: "not-a-number" })).toThrow();
  });

  it("requires a postgres DATABASE_URL", () => {
    expect(() => testEnv({ DATABASE_URL: "mysql://localhost/db" })).toThrow();
  });

  it("refuses development auth in production", () => {
    expect(() => testEnv({ NODE_ENV: "production", AUTH_MODE: "dev" })).toThrow();
  });
});
