/**
 * Standalone database migration entrypoint (`node dist/migrate.js`, SPEC.md section 14.3).
 */

import { loadConfig } from "./config.js";
import { createDatabase, runMigrations } from "./db/index.js";

/**
 * Connects to `DATABASE_URL`, runs all pending forward-only migrations, and closes the pool.
 *
 * @example
 * ```ts
 * await migrateMain();
 * ```
 */
export async function migrateMain(): Promise<void> {
  const config = loadConfig();
  const handle = createDatabase(config.DATABASE_URL, { max: 2 });
  try {
    const applied = await runMigrations(handle.sql);
    console.log(
      JSON.stringify({
        msg: "Database migrations complete",
        applied,
      }),
    );
  } finally {
    await handle.close();
  }
}

if (import.meta.main) {
  migrateMain().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
