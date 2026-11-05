/**
 * One error type for every *expected* failure (not found, conflict, forbidden…).
 * Services throw these; the central error handler turns them into RFC 9457
 * Problem Details responses. Routes never build error JSON by hand.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    /** Stable, machine-readable code clients can switch on, e.g. "account_has_transactions". */
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: Array<{ path: string; message: string }>,
    /** Extra response headers, e.g. Retry-After on a 429. */
    readonly headers?: Record<string, string>,
  ) {
    super(detail ?? title);
    this.name = "AppError";
  }
}

export const notFound = (resource: string) =>
  new AppError(404, "not_found", `${resource} not found`);

export const conflict = (code: string, detail: string) =>
  new AppError(409, code, "Conflict", detail);

export const forbidden = (detail: string) => new AppError(403, "forbidden", "Forbidden", detail);

export const unauthorized = (detail = "Authentication is required") =>
  new AppError(401, "unauthorized", "Unauthorized", detail);

/** 422: the request is well-formed, but breaks a business rule. */
export const unprocessable = (code: string, path: string, message: string) =>
  new AppError(422, code, "Unprocessable request", message, [{ path, message }]);
