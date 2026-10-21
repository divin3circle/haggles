/**
 * HTTP server entrypoint with graceful `SIGTERM` / `SIGINT` shutdown (SPEC.md section 9.3).
 */

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";

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
  const app = await buildApp({ config, dbHandle });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
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
