/**
 * Dynamic runtime reverse-proxy route handler for `/portal/v1/*` (SPEC.md sections 3.4 and 8.3).
 *
 * Proxies `/portal/v1/*` requests directly to the live Haggles API server at request time,
 * resolving `PUBLIC_API_URL` dynamically from runtime environment variables.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getApiBase(): string {
  const url =
    process.env.PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.API_INTERNAL_URL ??
    "http://localhost:3001";
  return url.replace(/\/$/, "");
}

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  const targetPath = path.join("/");
  const search = request.nextUrl.search;
  const apiBase = getApiBase();
  const targetUrl = `${apiBase}/portal/v1/${targetPath}${search}`;

  const forwardHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (key.toLowerCase() !== "host") {
      forwardHeaders.set(key, value);
    }
  }

  const reqInit: RequestInit = {
    method: request.method,
    headers: forwardHeaders,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    reqInit.body = await request.arrayBuffer();
  }

  try {
    const upstreamRes = await fetch(targetUrl, reqInit);

    const responseHeaders = new Headers();
    upstreamRes.headers.forEach((value, key) => {
      // Allow Next.js runtime to manage transfer/encoding
      if (key.toLowerCase() !== "content-encoding" && key.toLowerCase() !== "content-length") {
        responseHeaders.set(key, value);
      }
    });

    const setCookies =
      typeof upstreamRes.headers.getSetCookie === "function"
        ? upstreamRes.headers.getSetCookie()
        : upstreamRes.headers.get("set-cookie")
          ? [upstreamRes.headers.get("set-cookie")!]
          : [];

    const responseBody = await upstreamRes.arrayBuffer();
    const response = new NextResponse(responseBody, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: responseHeaders,
    });

    for (const cookie of setCookies) {
      response.headers.append("set-cookie", cookie);
    }

    return response;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to connect to Haggles API";
    return NextResponse.json(
      {
        error: {
          code: "API_UNREACHABLE",
          message: msg,
          targetUrl,
        },
      },
      { status: 502 },
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
