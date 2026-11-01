import { HealthResponseSchema } from "@ledgerly/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

describe("API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }));
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns a response matching the shared contract", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    // Validating against the SAME schema the front end uses proves the contract holds.
    const body = HealthResponseSchema.parse(response.json());
    expect(body.status).toBe("ok");
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

describe("env", () => {
  it("rejects an invalid port at startup", () => {
    expect(() => loadEnv({ PORT: "not-a-number", LOG_LEVEL: "silent" })).toThrow();
  });
});
