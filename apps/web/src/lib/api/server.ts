import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { ApiError } from "./errors";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/**
 * Calls the API from the Next.js SERVER (Server Components), forwarding the
 * visitor's cookies so the API sees the same session the browser has.
 * A 401 means the session is gone: send them to sign in.
 */
export async function serverApi<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { cookie: (await cookies()).toString() },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 401) redirect("/login");

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, (data ?? {}) as object);
  return schema.parse(data);
}
