import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

/**
 * Where a page goes when the API says the session is no longer valid
 * (signed out everywhere, password reset, expired).
 *
 * It DELETES the stale cookie, then continues to /login. Redirecting straight
 * to /login used to loop forever: the proxy sends anyone WITH a session cookie
 * from /login to /app, and /app sent them back (found in Stage 15).
 */
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  for (const name of SESSION_COOKIE_NAMES) {
    // A __Host- cookie can only be replaced by one with the same attributes.
    response.cookies.set(name, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: name.startsWith("__Host-"),
    });
  }
  return response;
}
