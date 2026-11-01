import { ProblemSchema } from "@ledgerly/shared";

/** Declares which error responses a route can return (for OpenAPI docs + serialization). */
export function problems<const C extends readonly number[]>(...codes: C) {
  return Object.fromEntries(codes.map((code) => [code, ProblemSchema])) as {
    [K in C[number]]: typeof ProblemSchema;
  };
}

/** Errors every household-scoped route can produce. */
export const commonProblems = problems(400, 401, 403, 404);
