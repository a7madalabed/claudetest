import { createDb } from "@ledgerly/db";
import { HealthResponseSchema, ProblemSchema } from "@ledgerly/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { OWNER, request, testEnv, useTestApp } from "./test/helpers.js";

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

describe("operations", () => {
  const ctx = useTestApp();

  it("while draining, readiness says 503 but liveness stays 200", async () => {
    ctx.app.draining = true;
    try {
      const ready = await ctx.app.inject({ method: "GET", url: "/health/ready" });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toMatchObject({ status: "draining" });
      expect((await ctx.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    } finally {
      ctx.app.draining = false;
    }
  });

  it("keeps a well-formed upstream request id, and replaces anything else", async () => {
    const send = (id: string) =>
      ctx.app.inject({ method: "GET", url: "/health", headers: { "x-request-id": id } });
    const upstream = "4f0e9d8c-5b1a-4c2e-9f7d-0a1b2c3d4e5f";
    expect((await send(upstream)).headers["x-request-id"]).toBe(upstream);

    const forged = (await send("evil\nFAKE LOG LINE level=error")).headers["x-request-id"];
    expect(forged).not.toContain("FAKE");
    expect(forged).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reports which build is running", async () => {
    const health = (await ctx.app.inject({ method: "GET", url: "/health" })).json();
    expect(health.version).toBe("dev"); // APP_VERSION, baked into the image at build time
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

  it("refuses insecure cookies in production", () => {
    // MAIL_DRIVER: production also requires a deliberate mail setting (Stage 15).
    const production = { NODE_ENV: "production", MAIL_DRIVER: "log" };
    expect(() => testEnv({ ...production, COOKIE_SECURE: "false" })).toThrow();
    expect(testEnv(production).COOKIE_SECURE).toBe(true);
  });

  it("requires a 32-byte encryption key", () => {
    expect(() => testEnv({ ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow();
  });
});
