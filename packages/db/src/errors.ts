/**
 * Postgres reports constraint violations with standard SQLSTATE codes.
 * The API (Stage 4) turns these into proper HTTP responses, e.g. a duplicate
 * category name (23505) becomes "409 Conflict" instead of a generic 500.
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PgErrorCode = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  notNullViolation: "23502",
} as const;

export type PgErrorCodeName = keyof typeof PgErrorCode;

interface PgLikeError {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

/** Finds the underlying Postgres error, even if a library wrapped it. */
export function getPgError(error: unknown): { code: string; constraint?: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const candidate = current as PgLikeError;
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return { code: candidate.code, constraint: candidate.constraint };
    }
    current = candidate.cause;
  }
  return undefined;
}

export function isPgError(error: unknown, name: PgErrorCodeName, constraint?: string): boolean {
  const pgError = getPgError(error);
  return (
    pgError?.code === PgErrorCode[name] &&
    (constraint === undefined || pgError.constraint === constraint)
  );
}
