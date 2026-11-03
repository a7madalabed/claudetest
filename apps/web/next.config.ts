import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /*
   * A self-contained server for production (Stage 14): `next build` traces which
   * files the server actually needs and copies them, with a minimal node_modules,
   * into .next/standalone. The container image ships only that, not the whole
   * monorepo. The trace root is the repo root, because workspace packages
   * (@ledgerly/shared) live outside apps/web.
   */
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // Don't advertise which framework we run (a tiny bit less info for attackers).
  poweredByHeader: false,
  // Dev-only badge: bottom-left keeps it clear of sheet/dialog action buttons.
  devIndicators: { position: "bottom-left" },
  // NOTE: no `rewrites()` for /api any more. Next resolves those at BUILD time,
  // which tied each build to one environment; the proxy now lives in src/proxy.ts
  // and reads API_URL per request.
};

export default nextConfig;
