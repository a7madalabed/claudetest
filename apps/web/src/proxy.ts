import { NextResponse, type NextRequest } from "next/server";
import { apiUrl } from "./lib/api-url";
import { SESSION_COOKIE_NAMES } from "./lib/session-cookie";

/**
 * Next.js Proxy (formerly "middleware") runs before every matched request, on
 * the Node.js runtime, at REQUEST time. It does two jobs:
 *
 * 1. THE /api PROXY. The browser talks to the API through the web app's own
 *    origin:  https://app.example.com/api/v1/me  →  http://api:4000/v1/me
 *    Same origin means first-party cookies (server components can read the
 *    session), no CORS preflights, and the API's address stays private.
 *    This used to be a `rewrites()` entry in next.config.ts — but Next resolves
 *    those at BUILD time, so every environment needed its own build. Here the
 *    target is read per request, so one image runs everywhere (Stage 14).
 *
 * 2. AN OPTIMISTIC SIGN-IN CHECK: "is there a session cookie at all?" — enough
 *    to send signed-out visitors to /login without rendering a protected page.
 *    It is NOT security: a forged or expired cookie passes, and is then rejected
 *    by the API, the real gatekeeper (the pattern the Next.js docs recommend).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.rewrite(new URL(`${pathname.slice("/api".length)}${search}`, apiUrl()));
  }

  const hasSession = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));

  if (pathname.startsWith("/app") && !hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  if ((pathname === "/login" || pathname === "/signup") && hasSession) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/app/:path*", "/login", "/signup"],
};
