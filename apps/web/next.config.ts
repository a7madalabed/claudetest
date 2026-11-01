import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't advertise which framework we run (a tiny bit less info for attackers).
  poweredByHeader: false,
};

export default nextConfig;
