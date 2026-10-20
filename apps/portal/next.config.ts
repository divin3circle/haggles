/**
 * Next.js 16 configuration for `@haggles/portal` (SPEC.md sections 3.4 and 8.2).
 *
 * Proxies `/portal/v1/*` same-origin to the Haggles API server so session cookies (`hg_session`)
 * and double-submit CSRF tokens (`hg_csrf`) work without cross-origin CORS.
 */

import type { NextConfig } from "next";

const apiInternalUrl = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3001"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@haggles/core"],
  async rewrites() {
    return [
      {
        source: "/portal/v1/:path*",
        destination: `${apiInternalUrl}/portal/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
