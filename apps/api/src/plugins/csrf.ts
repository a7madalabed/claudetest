import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AppError } from "../lib/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-Site Request Forgery (CSRF) protection, in layers:
 *
 *  1. SameSite=Lax session cookies (auth plugin): browsers don't attach them to
 *     cross-site POST/PATCH/DELETE requests at all.
 *  2. This hook: for state-changing requests, reject anything a browser marks as
 *     coming from another site — via the Fetch Metadata header `Sec-Fetch-Site`,
 *     or an `Origin` that isn't us or one of our front ends.
 *  3. Bodies must be JSON (text/plain parsing is removed in app.ts). Plain HTML
 *     forms — the classic CSRF weapon — can't send application/json.
 *
 * Requests with no Origin (curl, server-to-server) aren't browser-driven, so CSRF
 * doesn't apply to them; they still need a valid session.
 */
export const csrfPlugin = fp(
  async (app: FastifyInstance, opts: { allowedOrigins: string[] }) => {
    app.addHook("onRequest", async (request) => {
      if (SAFE_METHODS.has(request.method)) return;

      const reject = (reason: string) => {
        request.log.warn(
          { origin: request.headers.origin, reason },
          "Blocked possible CSRF request",
        );
        throw new AppError(403, "csrf_rejected", "Cross-site request blocked", reason);
      };

      if (request.headers["sec-fetch-site"] === "cross-site")
        reject("Requests from other sites aren't allowed.");

      const origin = request.headers.origin;
      if (origin) {
        const sameOrigin = (() => {
          try {
            return new URL(origin).host === request.headers.host;
          } catch {
            return false;
          }
        })();
        if (!sameOrigin && !opts.allowedOrigins.includes(origin))
          reject(`Origin ${origin} isn't allowed.`);
      }
    });
  },
  { name: "csrf" },
);
