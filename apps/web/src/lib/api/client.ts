import type { z } from "zod";
import { ApiError } from "./errors";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions<S extends z.ZodType | undefined> {
  method?: Method;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as-is with its own content type (e.g. a CSV file as text/csv). */
  rawBody?: { contentType: string; data: string };
  /** Validates the response shape at runtime with the SAME schema the API uses. */
  schema?: S;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * The browser-side API client. Requests go to `/api/...` on our own origin and
 * are proxied to the API (see src/proxy.ts), so the session cookie is sent
 * automatically and never touched by JavaScript.
 */
export async function api<S extends z.ZodType | undefined = undefined>(
  path: string,
  { method = "GET", body, rawBody, schema, signal, headers }: RequestOptions<S> = {},
): Promise<S extends z.ZodType ? z.infer<S> : unknown> {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined && { "content-type": "application/json" }),
      ...(rawBody && { "content-type": rawBody.contentType }),
      ...headers,
    },
    body: rawBody ? rawBody.data : body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as never;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, (data ?? {}) as object);

  return (schema ? schema.parse(data) : data) as never;
}
