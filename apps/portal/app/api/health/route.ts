/**
 * Portal health check endpoint (`GET /api/health`, SPEC.md section 14.3).
 */

import { NextResponse } from "next/server";

/**
 * Returns `200 OK` with `{ status: "ok" }` for Render health checks.
 */
export function GET(): NextResponse {
  return NextResponse.json({ status: "ok", service: "haggles-portal" });
}
