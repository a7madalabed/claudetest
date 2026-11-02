import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't advertise which framework we run (a tiny bit less info for attackers).
  poweredByHeader: false,
  // The dev-only Next.js badge would otherwise sit on top of the sidebar's user menu.
  devIndicators: { position: "bottom-right" },
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
