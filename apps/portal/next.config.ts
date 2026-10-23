/**
 * Next.js 16 configuration for `@haggles/portal` (SPEC.md sections 3.4 and 8.2).
 *
 * Proxies `/portal/v1/*` same-origin to the Haggles API server so session cookies (`hg_session`)
 * and double-submit CSRF tokens (`hg_csrf`) work without cross-origin CORS.
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@haggles/core"],
};

export default nextConfig;
