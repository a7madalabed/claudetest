import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The end-to-end suite builds into its own folder (e2e/scripts/build-web.ts).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Don't advertise which framework we run (a tiny bit less info for attackers).
  poweredByHeader: false,
  // Dev-only badge: bottom-left keeps it clear of sheet/dialog action buttons.
  devIndicators: { position: "bottom-left" },
  /**
   * The browser talks to the API through the web app's own origin:
   *   http://localhost:3000/api/v1/me  →  http://localhost:4000/v1/me
   *
   * Same origin means: first-party cookies (the session cookie belongs to the web
   * app's domain, so server components can read it), no CORS preflight requests,
   * and the API's address is an implementation detail the browser never sees.
   */
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
