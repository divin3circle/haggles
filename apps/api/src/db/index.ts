/**
 * Database connection pool, Drizzle ORM instance, and migration runner (SPEC.md sections 3.3, 6.1, 9.2, 9.3).
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { INITIAL_SCHEMA_SQL } from "./migrations.js";
import * as schema from "./schema.js";

/**
 * Typed Drizzle database instance with the Haggles schema.
 *
 * @example
 * ```ts
 * const { db, sql } = createDatabase(config.DATABASE_URL);
 * ```
 */
export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Database handle combining the raw `postgres.js` client and the Drizzle ORM wrapper.
 *
 * @example
 * ```ts
 * const handle = createDatabase("postgres://haggles:haggles@localhost:5432/haggles");
 * await handle.close();
 * ```
 */
export interface DatabaseHandle {
  /** Drizzle ORM instance */
  readonly db: Database;
  /** Raw `postgres.js` tagged-template SQL client */
  readonly sql: Sql;
  /** Closes the underlying connection pool within 10 seconds (SPEC.md section 9.3) */
  close(): Promise<void>;
}

const MIGRATIONS: ReadonlyArray<{ readonly id: string; readonly sql: string }> = [
  { id: "0000_initial_schema", sql: INITIAL_SCHEMA_SQL },
];

/**
 * Creates a `postgres.js` connection pool and Drizzle ORM handle (SPEC.md section 9.2).
 *
 * @param connectionString - PostgreSQL connection URI
 * @param options - Optional pool size override (`max`, defaults to 10)
 * @returns {@link DatabaseHandle}
 *
 * @example
 * ```ts
 * const { db, sql, close } = createDatabase(process.env.DATABASE_URL!);
 * ```
 */
export function createDatabase(
  connectionString: string,
  options?: { max?: number | undefined },
): DatabaseHandle {
  const sql = postgres(connectionString, {
    max: options?.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    async close(): Promise<void> {
      await sql.end({ timeout: 10 });
    },
  };
}

/**
 * Applies all pending forward-only database migrations in a transaction using an advisory lock
 * so concurrent startups cannot race (SPEC.md section 14.3).
 *
 * @param sql - `postgres.js` SQL client
 * @returns List of migration IDs applied during this invocation
 *
 * @example
 * ```ts
 * const applied = await runMigrations(handle.sql);
 * ```
 */
export async function runMigrations(sql: Sql): Promise<string[]> {
  const appliedNow: string[] = [];
  await sql.begin(async (tx) => {
    await tx.unsafe("SELECT pg_advisory_xact_lock(4022026)");
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS haggles_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const existingRows = await tx.unsafe<Array<{ id: string }>>(
      "SELECT id FROM haggles_migrations ORDER BY id ASC",
    );
    const existing = new Set(existingRows.map((r) => r.id));

    for (const migration of MIGRATIONS) {
      if (existing.has(migration.id)) continue;
      await tx.unsafe(migration.sql);
      await tx.unsafe("INSERT INTO haggles_migrations (id) VALUES ($1)", [migration.id]);
      appliedNow.push(migration.id);
    }
  });
  return appliedNow;
}

/**
 * Checks whether PostgreSQL is reachable and all required migrations have been applied (SPEC.md sections 5.1 and 9.3).
 *
 * @param sql - `postgres.js` SQL client
 * @returns `{ ready: true }` if reachable and migrated, or `{ ready: false, reason }` otherwise
 *
 * @example
 * ```ts
 * const status = await checkDatabaseReady(handle.sql);
 * ```
 */
export async function checkDatabaseReady(
  sql: Sql,
): Promise<{ ready: boolean; reason?: string | undefined }> {
  try {
    const rows = await sql.unsafe<Array<{ id: string }>>(
      "SELECT id FROM haggles_migrations ORDER BY id ASC",
    );
    const applied = new Set(rows.map((r) => r.id));
    for (const migration of MIGRATIONS) {
      if (!applied.has(migration.id)) {
        return { ready: false, reason: `Missing migration: ${migration.id}` };
      }
    }
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      reason: error instanceof Error ? error.message : "Database unreachable",
    };
  }
}

export * from "./schema.js";
export { INITIAL_SCHEMA_SQL } from "./migrations.js";
