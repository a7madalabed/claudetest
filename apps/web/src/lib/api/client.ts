import type { z } from "zod";
import { ApiError } from "./errors";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions<S extends z.ZodType | undefined> {
  method?: Method;
  body?: unknown;
  /** Validates the response shape at runtime with the SAME schema the API uses. */
  schema?: S;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * The browser-side API client. Requests go to `/api/...` on our own origin and
 * are proxied to the API (see next.config.ts), so the session cookie is sent
 * automatically and never touched by JavaScript.
 */
export async function api<S extends z.ZodType | undefined = undefined>(
  path: string,
  { method = "GET", body, schema, signal, headers }: RequestOptions<S> = {},
): Promise<S extends z.ZodType ? z.infer<S> : unknown> {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: "same-origin",
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as never;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, (data ?? {}) as object);

  return (schema ? schema.parse(data) : data) as never;
}
