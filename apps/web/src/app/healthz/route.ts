/**
 * LIVENESS for the web container: "is this Next.js process able to answer?".
 *
 * Deliberately does NOT call the API. If it did, an API outage would mark every
 * healthy web container as dead and the platform would restart them all — one
 * failure becoming two. Whether the whole system works is the API's
 * /health/ready (reachable through /api/health/ready).
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", version: process.env.APP_VERSION ?? "dev" },
    { headers: { "cache-control": "no-store" } },
  );
}
