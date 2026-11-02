import type { Problem } from "@ledgerly/shared";

/**
 * Every API error is RFC 9457 Problem Details (Stage 4), so the front end needs
 * exactly ONE error type. Components switch on `code`, never on message text.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
  readonly fieldErrors: Array<{ path: string; message: string }>;
  readonly requestId?: string;

  constructor(status: number, problem: Partial<Problem>) {
    super(problem.detail ?? problem.title ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = problem.code ?? (status >= 500 ? "internal_error" : "unknown_error");
    this.title = problem.title ?? "Something went wrong";
    this.detail = problem.detail;
    this.fieldErrors = problem.errors ?? [];
    this.requestId = problem.requestId;
  }

  /** "body.email" → "email": maps API field errors onto form fields. */
  fieldError(field: string): string | undefined {
    return this.fieldErrors.find((error) => error.path.split(".").at(-1) === field)?.message;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

/** A friendly, human sentence for any error (used by toasts and error states). */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 429) return error.detail ?? "Too many attempts. Please wait a moment.";
    if (error.status >= 500) return "Something went wrong on our side. Please try again.";
    return error.detail ?? error.title;
  }
  if (error instanceof TypeError) return "Can't reach the server. Check your connection.";
  return "Something went wrong.";
}
