import cookie from "@fastify/cookie";
import type { Session } from "@ledgerly/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { AppError, unauthorized } from "../lib/errors.js";
import { findSession, touchSession } from "../modules/auth/sessions.service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The authenticated user. Set by `app.authenticate`. */
    user?: { id: string; email: string; displayName: string; mfaEnabled: boolean };
    /** The session behind this request. */
    session?: Session;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    setSessionCookie: (reply: FastifyReply, token: string, expiresAt: Date) => void;
    clearSessionCookie: (reply: FastifyReply) => void;
    sessionCookieName: string;
  }
  interface FastifyContextConfig {
    /** Allow sessions that passed the password step but not yet 2FA (e.g. the 2FA endpoint itself). */
    allowMfaPending?: boolean;
  }
}

interface AuthOptions {
  cookieSecure: boolean;
  idleDays: number;
}

/**
 * Cookie-based session authentication.
 *
 * The cookie is:
 *  - HttpOnly  → JavaScript can't read it, so an XSS bug can't steal the session
 *  - Secure    → only sent over HTTPS (in production)
 *  - SameSite=Lax → not sent on cross-site POSTs: the main defence against CSRF
 *  - __Host- prefix (when Secure) → browsers enforce Secure + Path=/ + no Domain,
 *    so a compromised subdomain can't overwrite it
 */
export const authPlugin = fp(
  async (app: FastifyInstance, opts: AuthOptions) => {
    await app.register(cookie);

    const cookieName = opts.cookieSecure ? "__Host-ledgerly_session" : "ledgerly_session";
    app.decorate("sessionCookieName", cookieName);
    app.decorateRequest("user", undefined);
    app.decorateRequest("session", undefined);

    app.decorate("setSessionCookie", (reply: FastifyReply, token: string, expiresAt: Date) => {
      reply.setCookie(cookieName, token, {
        httpOnly: true,
        secure: opts.cookieSecure,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
      });
    });

    app.decorate("clearSessionCookie", (reply: FastifyReply) => {
      reply.clearCookie(cookieName, {
        httpOnly: true,
        secure: opts.cookieSecure,
        sameSite: "lax",
        path: "/",
      });
    });

    app.decorate("authenticate", async (request: FastifyRequest) => {
      const token = request.cookies[cookieName];
      if (!token) throw unauthorized();

      const found = await findSession(app.db, token, opts.idleDays);
      if (!found) throw unauthorized("Your session has expired. Please sign in again.");

      if (found.session.mfaPending && !request.routeOptions.config.allowMfaPending) {
        throw new AppError(
          401,
          "mfa_required",
          "Two-factor authentication required",
          "Enter the code from your authenticator app.",
        );
      }

      await touchSession(app.db, found.session);
      request.session = found.session;
      request.user = {
        id: found.user.id,
        email: found.user.email,
        displayName: found.user.displayName,
        mfaEnabled: found.user.totpEnabledAt !== null,
      };
    });
  },
  { name: "auth", dependencies: ["database"] },
);
