/**
 * Keep-alive health check script for Haggles Render services (`SPEC.md` sections 5.1 and 9.3).
 *
 * Pings the Facilitator API readiness endpoint (`/ready`) and Portal health endpoint (`/api/health`)
 * every 14 minutes (just under Render's 15-minute idle spin-down threshold) so both services stay
 * warm and responsive.
 *
 * Usage:
 * - Continuous loop (every 14m): `bun run keepalive`
 * - Single check (e.g. cron/CI): `bun scripts/keepalive.ts --once`
 */

const DEFAULT_API_URL = "https://haggles-api.onrender.com";
const DEFAULT_PORTAL_URL = "https://haggles-portal.onrender.com";
const DEFAULT_INTERVAL_MS = 14 * 60 * 1000; // 14 minutes
const REQUEST_TIMEOUT_MS = 60_000; // 60s to allow cold-start wakeups

/**
 * Result of pinging a single target endpoint.
 */
export interface PingResult {
  name: string;
  url: string;
  ok: boolean;
  status: number | null;
  durationMs: number;
  error?: string | undefined;
}

/**
 * Pings a single HTTP endpoint with a 60-second timeout to accommodate cold-start wakeups.
 *
 * @param name - Human-readable service name
 * @param url - Full health/readiness URL to ping
 * @returns Structured {@link PingResult}
 *
 * @example
 * ```ts
 * const res = await pingEndpoint("haggles-api", "https://haggles-api.onrender.com/ready");
 * ```
 */
export async function pingEndpoint(name: string, url: string): Promise<PingResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "haggles-keepalive/1.0",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const durationMs = Date.now() - start;
    return {
      name,
      url,
      ok: res.ok,
      status: res.status,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    return {
      name,
      url,
      ok: false,
      status: null,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Runs one keep-alive cycle across both `haggles-api` (`/ready`) and `haggles-portal` (`/api/health`).
 *
 * @param apiBaseUrl - Base URL of the Haggles API
 * @param portalBaseUrl - Base URL of the Haggles Portal
 * @returns Array of {@link PingResult} for each service
 *
 * @example
 * ```ts
 * await runKeepAliveCycle();
 * ```
 */
export async function runKeepAliveCycle(
  apiBaseUrl: string = process.env.PUBLIC_API_URL ?? DEFAULT_API_URL,
  portalBaseUrl: string = process.env.PUBLIC_PORTAL_URL ?? DEFAULT_PORTAL_URL,
): Promise<PingResult[]> {
  const apiReadyUrl = `${apiBaseUrl.replace(/\/$/, "")}/ready`;
  const portalHealthUrl = `${portalBaseUrl.replace(/\/$/, "")}/api/health`;
  const timestamp = new Date().toISOString();

  const results = await Promise.all([
    pingEndpoint("haggles-api", apiReadyUrl),
    pingEndpoint("haggles-portal", portalHealthUrl),
  ]);

  for (const r of results) {
    if (r.ok) {
      console.log(
        `[${timestamp}] [KEEPALIVE] OK   ${r.name.padEnd(15)} HTTP ${r.status} (${r.durationMs}ms) -> ${r.url}`,
      );
    } else {
      console.warn(
        `[${timestamp}] [KEEPALIVE] WARN ${r.name.padEnd(15)} ${r.status ? `HTTP ${r.status}` : (r.error ?? "FAILED")} (${r.durationMs}ms) -> ${r.url}`,
      );
    }
  }

  return results;
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const intervalMs = Number(process.env.KEEPALIVE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);

  const initial = await runKeepAliveCycle();
  if (once) {
    const allOk = initial.every((r) => r.ok);
    if (!allOk) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(
    `[KEEPALIVE] Watching services every ${Math.round(intervalMs / 60000)} minutes (Ctrl+C to stop)...`,
  );
  setInterval(() => {
    void runKeepAliveCycle();
  }, intervalMs);
}

if (import.meta.main) {
  void main();
}
