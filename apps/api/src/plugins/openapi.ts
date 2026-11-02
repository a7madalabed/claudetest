import swagger from "@fastify/swagger";
import scalar from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { jsonSchemaTransform, jsonSchemaTransformObject } from "fastify-type-provider-zod";

/**
 * OpenAPI documentation GENERATED from the same Zod schemas that validate requests.
 * The docs can't drift from reality, because they ARE the validation rules.
 *
 *   /openapi.json  machine-readable spec (generate typed clients, import into Postman…)
 *   /docs          interactive reference where you can try every endpoint
 */
export const openApiPlugin = fp(
  async (app: FastifyInstance, opts: { version: string; cookieName: string }) => {
    await app.register(swagger, {
      openapi: {
        openapi: "3.1.0",
        info: {
          title: "Ledgerly API",
          version: opts.version,
          description:
            "REST API for Ledgerly. All money values are integers in minor units (cents). " +
            "Errors use RFC 9457 Problem Details (`application/problem+json`).",
        },
        servers: [{ url: "http://localhost:4000", description: "Local development" }],
        tags: [
          { name: "Auth", description: "Sign-up, sign-in, two-factor authentication and sessions" },
          { name: "Households", description: "The current user and their households" },
          { name: "Accounts", description: "Bank accounts, cards and cash" },
          { name: "Categories", description: "Two-level income/expense categories" },
          { name: "Transactions", description: "Money in, money out, and transfers" },
          { name: "Budgets", description: "Monthly category budgets with rollover" },
          { name: "Goals", description: "Savings goals with projections" },
          { name: "Reports", description: "Aggregated views for dashboards" },
          { name: "System", description: "Health checks" },
        ],
        components: {
          securitySchemes: {
            session: {
              type: "apiKey",
              in: "cookie",
              name: opts.cookieName,
              description:
                "HttpOnly session cookie set by POST /v1/auth/login. In these docs, sign in " +
                "first (demo: demo@ledgerly.app / correct-horse-ledger) and the browser sends it automatically.",
            },
          },
        },
        security: [{ session: [] }],
      },
      transform: jsonSchemaTransform,
      transformObject: jsonSchemaTransformObject,
    });

    app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

    // The docs page is the ONE place that serves HTML with inline scripts. We relax
    // the Content-Security-Policy only inside this encapsulated scope; every JSON
    // route keeps helmet's strict default.
    await app.register(async (docs) => {
      docs.addHook("onSend", async (_request, reply) => {
        reply.header(
          "content-security-policy",
          [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self' data: https:",
            "connect-src 'self'",
            "frame-ancestors 'none'",
          ].join("; "),
        );
      });
      await docs.register(scalar, {
        routePrefix: "/docs",
        configuration: { title: "Ledgerly API", url: "/openapi.json" },
      });
    });
  },
  { name: "openapi" },
);
