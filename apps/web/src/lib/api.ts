import "server-only";
import { HealthResponseSchema, type HealthResponse } from "@ledgerly/shared";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type ApiHealth = { ok: true; data: HealthResponse } | { ok: false; error: string };

/**
 * Calls the API's /health endpoint from the Next.js *server*.
 *
 * - `server-only` makes the build fail if this file is ever imported into
 *   browser code, so internal URLs can't leak to users.
 * - The response is validated with the shared Zod schema: we never trust data
 *   that crosses a network boundary, even from our own API.
 * - Errors become a value instead of an exception, so the page can show a
 *   friendly state instead of crashing.
 */
export async function getApiHealth(): Promise<ApiHealth> {
  try {
    const response = await fetch(`${API_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return { ok: false, error: `API responded with ${response.status}` };

    const parsed = HealthResponseSchema.safeParse(await response.json());
    if (!parsed.success) return { ok: false, error: "API sent an unexpected response shape" };

    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, error: "Can't reach the API — is it running on " + API_URL + "?" };
  }
}
