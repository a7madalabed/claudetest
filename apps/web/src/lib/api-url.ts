/**
 * Where the API lives, as seen from the web SERVER (never the browser).
 *
 * Read at REQUEST time, never at build time: one build (one container image)
 * must run unchanged in every environment — only its configuration differs.
 * Stage 13 found the old /api rewrite in next.config.ts was baked into the
 * build; Stage 14 moved it into proxy.ts, which reads this per request.
 */
export const apiUrl = () => process.env.API_URL ?? "http://localhost:4000";
