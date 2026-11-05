import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { apiUrl } from "../api-url";
import { ApiError } from "./errors";

/**
 * Calls the API from the Next.js SERVER (Server Components), forwarding the
 * visitor's cookies so the API sees the same session the browser has.
 * A 401 means the session is gone: send them to sign in.
 */
export async function serverApi<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  const incoming = await headers();
  const response = await fetch(`${apiUrl()}${path}`, {
    headers: {
      cookie: (await cookies()).toString(),
      /*
       * Pass on WHO is asking. Without it, every server-rendered page's API
       * calls come from this server's own address, and all users share ONE
       * rate-limit bucket: under real traffic everyone starts getting errors
       * (found by a load test during a deploy, Stage 14). The header was set
       * by our own proxy (Caddy), which discards any value a client sends.
       */
      ...(incoming.get("x-forwarded-for") && {
        "x-forwarded-for": incoming.get("x-forwarded-for")!,
      }),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  // The session is gone (expired, revoked, password reset): clear the stale
  // cookie on the way to /login, or the proxy would bounce us straight back.
  if (response.status === 401) redirect("/session-expired");

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, (data ?? {}) as object);
  return schema.parse(data);
}
