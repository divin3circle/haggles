/**
 * Next.js 16 configuration for `@haggles/portal` (SPEC.md sections 3.4 and 8.2).
 *
 * Proxies `/portal/v1/*` same-origin to the Haggles API server so session cookies (`hg_session`)
 * and double-submit CSRF tokens (`hg_csrf`) work without cross-origin CORS.
 */

import type { NextConfig } from "next";

const rawApiUrl =
  process.env.PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_INTERNAL_URL ??
  "http://localhost:3001";

const apiTarget = (
  rawApiUrl.startsWith("http://") || rawApiUrl.startsWith("https://")
    ? rawApiUrl
    : `http://${rawApiUrl}`
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@haggles/core"],
  async rewrites() {
    return [
      {
        source: "/portal/v1/:path*",
        destination: `${apiTarget}/portal/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
