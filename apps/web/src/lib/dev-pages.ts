/**
 * The design-system style guide (/design) is for people building Ledgerly, not
 * for its users. It's served in development, and in production only when
 * SHOW_DESIGN_PAGE=true is set on purpose (Stage 19). Read at request time, so
 * the pages that use it must be `force-dynamic`.
 */
export function designPageEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" || env.SHOW_DESIGN_PAGE === "true";
}
