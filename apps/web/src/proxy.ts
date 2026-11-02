import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES } from "./lib/session-cookie";

/**
 * Next.js Proxy (formerly "middleware") runs before every matched request.
 *
 * It performs an OPTIMISTIC check only: "is there a session cookie at all?".
 * That's enough to redirect signed-out visitors to /login without rendering a
 * protected page first. It is NOT security: a forged or expired cookie passes
 * this check, and is then rejected by the API — the real gatekeeper — when the
 * page asks for data. (The Next.js docs recommend exactly this split.)
 */
export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
  const { pathname, search } = request.nextUrl;

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
  matcher: ["/app/:path*", "/login", "/signup"],
};
