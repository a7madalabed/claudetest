import { z } from "zod";

/*
 * Building blocks shared by every API contract. `.meta({ id })` registers a schema
 * under a name, so the generated OpenAPI document shows it as a reusable component
 * (e.g. "Account") instead of repeating it inline everywhere.
 */

export const IdSchema = z.uuid().meta({ description: "UUID (v7 for server-created rows)" });

export const IsoDateSchema = z.iso
  .date()
  .meta({ description: "Calendar date, YYYY-MM-DD", example: "2026-03-14" });

export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 code like USD")
  .meta({ description: "ISO 4217 currency code", example: "USD" });

/** Money in minor units (cents). Bounded well inside JS's exact-integer range. */
export const MinorUnitsSchema = z
  .int()
  .min(-1_000_000_000_000)
  .max(1_000_000_000_000)
  .meta({ description: "Amount in minor units (e.g. cents). 1250 = $12.50", example: 1250 });

export const TimestampSchema = z.iso.datetime({ offset: true });

/** An IANA time zone the runtime knows ("Europe/Paris"). Intl is the source of truth. */
export const TimeZoneSchema = z
  .string()
  .max(64)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone")
  .meta({ description: "IANA time zone", example: "America/Los_Angeles" });

/** Trims whitespace, then enforces length — "   " is not a valid name. */
export const nameSchema = (max: number) => z.string().trim().min(1).max(max);

/**
 * RFC 9457 "Problem Details" — the standard JSON shape for HTTP API errors.
 * Every error the API returns looks like this, so clients need ONE error handler.
 */
export const ProblemSchema = z
  .object({
    type: z.string().meta({ description: "A URI identifying the problem type" }),
    title: z.string().meta({ description: "Short, human-readable summary" }),
    status: z.int(),
    detail: z.string().optional(),
    instance: z.string().optional().meta({ description: "The request path" }),
    code: z
      .string()
      .meta({ description: "Stable machine-readable error code", example: "not_found" }),
    requestId: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .meta({ description: "Field-level validation errors" }),
  })
  .meta({ id: "Problem" });

export type Problem = z.infer<typeof ProblemSchema>;

/** Wraps a list in the standard paginated envelope. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: "Pass as ?cursor= to get the next page. null = no more pages." }),
  });
}

export const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});
