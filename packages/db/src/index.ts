// Public API of @ledgerly/db.
export * from "./client.js";
export * from "./errors.js";
export * from "./migrate.js";
export * from "./queries.js";
export * from "./schema.js";
export { seedDemoData } from "./seed.js";

// Re-export Drizzle's SQL helpers so consumers (API, workers) import everything
// database-related from ONE place and can never end up on a different Drizzle version.
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
