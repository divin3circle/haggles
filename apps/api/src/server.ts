/**
 * HTTP server entrypoint with graceful `SIGTERM` / `SIGINT` shutdown (SPEC.md section 9.3).
 */

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, runMigrations } from "./db/index.js";
import { FacilitatorService } from "./services/facilitator.js";
import { runWorkerTick } from "./worker.js";

/**
 * Starts the Fastify HTTP server and registers graceful shutdown handlers (10-second drain timeout).
 *
 * @example
 * ```ts
 * await startServer();
 * ```
 */
export async function startServer(): Promise<void> {
  const config = loadConfig();
  const dbHandle = createDatabase(config.DATABASE_URL);

  // Automatically run forward-only migrations on boot (ensures compatibility with Render Free tier without preDeployCommand)
  try {
    const applied = await runMigrations(dbHandle.sql);
    if (applied.length > 0) {
      console.log(`[BOOT] Applied ${applied.length} database migration(s): ${applied.join(", ")}`);
    }
  } catch (err) {
    console.warn(`[BOOT] Database migration warning (continuing boot): ${err instanceof Error ? err.message : String(err)}`);
  }

  // Create shared facilitator instance for both routes and embedded worker tick
  const facilitator = await FacilitatorService.create(config, undefined, dbHandle);
  const app = await buildApp({ config, dbHandle, facilitator });

  // Embedded background worker loop (runs periodic hold expiration, sweeps, and invariant checks)
  let workerTimer: ReturnType<typeof setInterval> | null = null;
  if (!process.env.DISABLE_EMBEDDED_WORKER) {
    let tickCount = 0;
    workerTimer = setInterval(() => {
      tickCount++;
      const runReconcile = tickCount % 60 === 0; // every 15m (60 * 15s)
      const runInvariants = tickCount % 240 === 0; // every 1h (240 * 15s)
      const runKeepAlive = tickCount % 48 === 0; // every 12m (48 * 15s)
      if (runKeepAlive && config.NODE_ENV === "production") {
        const apiReady = `${config.PUBLIC_API_URL.replace(/\/$/, "")}/ready`;
        const portalHealth = `${config.PUBLIC_PORTAL_URL.replace(/\/$/, "")}/api/health`;
        void fetch(apiReady, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
        void fetch(portalHealth, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
      }
      void runWorkerTick(facilitator, {
        runPayoutReconciliation: runReconcile,
        runInvariantCheck: runInvariants,
      }).catch((err: unknown) => {
        app.log.error({ err }, "Embedded worker tick failed");
      });
    }, 15_000);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (workerTimer) {
      clearInterval(workerTimer);
      workerTimer = null;
    }
    app.log.info({ signal }, "Received shutdown signal; draining connections");
    const forceExitTimer = setTimeout(() => {
      app.log.error("Graceful shutdown timed out after 10s; forcing exit");
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    try {
      await app.close();
      await dbHandle.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Error during graceful shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: config.PORT, host: config.HOST });
  const redirectUri =
    config.PAYPAL_OIDC_REDIRECT_URI ??
    `${config.PUBLIC_PORTAL_URL.replace(/\/$/, "")}/portal/v1/auth/paypal/callback`;
  app.log.info(
    {
      paypal_mode: config.PAYPAL_MODE,
      portal_url: config.PUBLIC_PORTAL_URL,
      oidc_redirect_uri: redirectUri,
    },
    "Haggles API server ready",
  );
}

if (import.meta.main) {
  startServer().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
