import { NextResponse, type NextRequest } from "next/server";
import { apiUrl } from "./lib/api-url";
import { contentSecurityPolicy, staticSecurityHeaders } from "./lib/security-headers";
import { SESSION_COOKIE_NAMES } from "./lib/session-cookie";

/**
 * Next.js Proxy (formerly "middleware") runs before every matched request, on
 * the Node.js runtime, at REQUEST time. It does three jobs:
 *
 * 1. THE /api PROXY. The browser talks to the API through the web app's own
 *    origin:  https://app.example.com/api/v1/me  →  http://api:4000/v1/me
 *    Same origin means first-party cookies (server components can read the
 *    session), no CORS preflights, and the API's address stays private.
 *    This used to be a `rewrites()` entry in next.config.ts — but Next resolves
 *    those at BUILD time, so every environment needed its own build. Here the
 *    target is read per request, so one image runs everywhere (Stage 14).
 *
 * 2. SECURITY HEADERS on every page, including a Content Security Policy with
 *    a fresh nonce per response (lib/security-headers.ts, Stage 15).
 *
 * 3. AN OPTIMISTIC SIGN-IN CHECK: "is there a session cookie at all?" — enough
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
  const isApp = pathname === "/app" || pathname.startsWith("/app/");
  if (isApp && !hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  if ((pathname === "/login" || pathname === "/signup") && hasSession) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  // A page: render it with a fresh nonce, and send the security headers.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, {
    https:
      request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:",
    dev: process.env.NODE_ENV === "development",
  });
  // Next reads the policy from the REQUEST to find the nonce for its own
  // scripts; the root layout reads x-nonce for ours.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  for (const [name, value] of Object.entries(staticSecurityHeaders))
    response.headers.set(name, value);
  return response;
}

export const config = {
  // Every path except static files (which carry no HTML to protect).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
