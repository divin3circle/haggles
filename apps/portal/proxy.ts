/**
 * Next.js 16 `proxy.ts` implementing the per-response nonce Content-Security-Policy
 * required for the PayPal JS SDK (SPEC.md section 8.2).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Builds the strict Content-Security-Policy header string for a given per-response `<nonce>`
 * (`SPEC.md` section 8.2).
 *
 * @param nonce - Base64 cryptographic nonce for this response
 * @returns Formatted CSP header value
 *
 * @example
 * ```ts
 * const csp = buildPortalCsp("rAnd0mNonce==");
 * ```
 */
export function buildPortalCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com`,
    "connect-src 'self' https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
    "frame-src https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
    "child-src https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
    "img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
    "font-src 'self' https://*.paypalobjects.com",
    "style-src 'self' 'unsafe-inline' https://*.paypal.com https://*.paypalobjects.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Next.js 16 request proxy that injects `x-nonce` and `Content-Security-Policy` on every portal page response.
 *
 * @param request - Incoming `NextRequest`
 * @returns `NextResponse` with CSP and `x-nonce` headers
 *
 * @example
 * ```ts
 * export default proxy;
 * ```
 */
export function proxy(request: NextRequest): NextResponse {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = Buffer.from(bytes).toString("base64");
  const cspHeader = buildPortalCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("x-nonce", nonce);
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!portal/v1|_next/static|_next/image|favicon.ico).*)",
    },
  ],
};
