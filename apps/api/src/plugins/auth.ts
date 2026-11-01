import { eq, sql, users } from "@ledgerly/db";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { unauthorized } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The authenticated user. Set by `app.authenticate`. */
    user?: { id: string; email: string; displayName: string };
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

export const DEV_USER_HEADER = "x-dev-user-email";

/**
 * ⚠️ TEMPORARY, DEVELOPMENT-ONLY AUTHENTICATION.
 *
 * Until Stage 5 adds real sign-in (password hashing, sessions, cookies), requests
 * identify themselves with an `x-dev-user-email` header. The environment config
 * REFUSES to start in production with this mode (see config/env.ts), so it can't
 * ship by accident. Stage 5 replaces only this file's internals: routes keep
 * calling `app.authenticate` and reading `request.user`.
 */
export const authPlugin = fp(
  async (app: FastifyInstance) => {
    app.decorateRequest("user", undefined);

    app.decorate("authenticate", async (request) => {
      const email = request.headers[DEV_USER_HEADER];
      if (typeof email !== "string" || email.length === 0) {
        throw unauthorized(`Send the ${DEV_USER_HEADER} header (development auth).`);
      }
      const [user] = await app.db
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
        .limit(1);
      if (!user) throw unauthorized("Unknown user.");
      request.user = user;
    });
  },
  { name: "auth", dependencies: ["database"] },
);
