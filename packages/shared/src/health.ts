import { z } from "zod";

/**
 * The shape of `GET /health`.
 *
 * Defining it once with Zod gives us two things from a single source of truth:
 *  1. a runtime validator (`HealthResponseSchema.parse(...)`) for untrusted data, and
 *  2. a compile-time TypeScript type (`HealthResponse`) for our editors.
 * Both the API (which produces it) and the web app (which consumes it) import it,
 * so they can never silently drift apart.
 */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
