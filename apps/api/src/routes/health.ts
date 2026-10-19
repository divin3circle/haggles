/**
 * Liveness (`/health`) and readiness (`/ready`) endpoints (SPEC.md sections 5.1 and 9.3).
 */

import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { checkDatabaseReady, type DatabaseHandle } from "../db/index.js";

/**
 * TypeBox response schema for `GET /health` and `GET /ready`.
 *
 * @example
 * ```ts
 * const ok = { status: "ok" as const };
 * ```
 */
export const HealthResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("ok"), Type.Literal("not_ready")]),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * Registers the `GET /health` (process liveness) and `GET /ready` (database connectivity and migration status) routes.
 *
 * @param app - Fastify instance
 * @param deps - Optional database handle or custom readiness check function
 *
 * @example
 * ```ts
 * await registerHealthRoutes(app, { dbHandle });
 * ```
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  deps?: {
    dbHandle?: DatabaseHandle | undefined;
    checkReady?: (() => Promise<{ ready: boolean; reason?: string | undefined }>) | undefined;
  },
): Promise<void> {
  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Liveness probe",
        description: "Returns 200 OK whenever the API process is up (SPEC.md section 5.1).",
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => {
      return { status: "ok" as const };
    },
  );

  app.get(
    "/ready",
    {
      schema: {
        tags: ["system"],
        summary: "Readiness probe",
        description:
          "Verifies PostgreSQL connectivity and that all required migrations have been applied (SPEC.md sections 5.1 and 9.3).",
        response: {
          200: HealthResponseSchema,
          503: HealthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const checkFn =
        deps?.checkReady ??
        (deps?.dbHandle
          ? () => checkDatabaseReady(deps.dbHandle!.sql)
          : async () => ({ ready: true }));

      const status = await checkFn();
      if (!status.ready) {
        return reply.status(503).send({
          status: "not_ready" as const,
          ...(status.reason ? { reason: status.reason } : {}),
        });
      }
      return { status: "ok" as const };
    },
  );
}
