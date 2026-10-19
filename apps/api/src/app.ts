/**
 * Fastify 5 application factory for the Haggles facilitator and portal API.
 *
 * Implements SPEC.md sections 3.3, 4.11, 5.1, 8.2, 8.6, 8.7, and 9.3.
 */

import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import { type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  createId,
  ERROR_CATALOGUE,
  HagglesError,
  type HagglesErrorCode,
  type ProblemDetails,
} from "@haggles/core";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { type ApiConfig, loadConfig } from "./config.js";
import type { DatabaseHandle } from "./db/index.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerPortalRoutes } from "./routes/portal.js";
import { registerProtocolRoutes } from "./routes/protocol.js";
import { FacilitatorService } from "./services/facilitator.js";

/**
 * Redacted logger paths ensuring secrets, keys, cookies, and tokens are never logged (SPEC.md sections 0.2 rule 6 and 8.7).
 *
 * @example
 * ```ts
 * console.log(LOGGER_REDACT_PATHS.includes("req.headers.authorization")); // true
 * ```
 */
export const LOGGER_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["haggles-payment"]',
  'req.headers["haggles-receipt"]',
  'res.headers["set-cookie"]',
  'res.headers["haggles-receipt"]',
  "*.token",
  "*.key",
  "*.secret",
  "*.password",
  "*.client_secret",
  "*.private_enc",
  "*.key_hash",
] as const;

/**
 * Options for building a Haggles Fastify application instance.
 *
 * @example
 * ```ts
 * const app = await buildApp({ config: loadConfig({ LOG_LEVEL: "silent" }) });
 * ```
 */
export interface BuildAppOptions {
  /** Validated API configuration (loaded from `process.env` if omitted) */
  config?: ApiConfig | undefined;
  /** Optional database handle for routes and readiness checks */
  dbHandle?: DatabaseHandle | undefined;
  /** Optional pre-configured FacilitatorService instance */
  facilitator?: FacilitatorService | undefined;
  /** Optional custom readiness probe override for unit tests */
  checkReady?: (() => Promise<{ ready: boolean; reason?: string | undefined }>) | undefined;
}

/**
 * Sends an RFC 9457 `application/problem+json` response (SPEC.md section 4.11 and Appendix A).
 *
 * @param reply - Fastify reply object
 * @param docsBaseUrl - Base URL for error type URIs
 * @param code - Haggles error code from Appendix A
 * @param detail - Actionable human-readable explanation
 * @param requestId - Request correlation ID (`req_...`)
 * @param statusOverride - Optional HTTP status override
 *
 * @example
 * ```ts
 * sendProblem(reply, "https://docs.haggles.example.com", "not_found", "Object does not exist.", "req_01J...");
 * ```
 */
export function sendProblem(
  reply: FastifyReply,
  docsBaseUrl: string,
  code: HagglesErrorCode,
  detail: string,
  requestId: string,
  statusOverride?: number,
): FastifyReply {
  const entry = ERROR_CATALOGUE[code] ?? ERROR_CATALOGUE.internal_error;
  const status = statusOverride ?? entry.status;
  const problem: ProblemDetails = {
    type: `${docsBaseUrl.replace(/\/$/, "")}/errors/${code}`,
    title: entry.title,
    status,
    code,
    detail,
    request_id: requestId,
  };
  return reply.status(status).header("content-type", "application/problem+json").send(problem);
}

/**
 * Builds and configures the Fastify 5 server with TypeBox, OpenAPI 3.1, Helmet, Pino redaction,
 * RFC 9457 error handling, and core routes (SPEC.md sections 3.3, 4.11, 5.1, 8.2, 8.7).
 *
 * @param options - Optional configuration and dependency overrides
 * @returns Configured Fastify instance
 *
 * @example
 * ```ts
 * const app = await buildApp();
 * await app.ready();
 * ```
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [...LOGGER_REDACT_PATHS],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 64 * 1024, // 64 KB limit (SPEC.md section 8.2)
    connectionTimeout: 5_000,
    requestTimeout: 5_000,
    genReqId: () => createId("req"),
    ajv: {
      customOptions: {
        removeAdditional: false,
        allErrors: false,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(helmet, {
    contentSecurityPolicy: false,
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
    },
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Haggles API",
        description:
          "Haggles facilitator protocol API (`/v1/*`), portal API (`/portal/v1/*`), and PayPal webhooks (SPEC.md section 5).",
        version: "0.1.0",
        license: {
          name: "MIT",
          url: "https://opensource.org/licenses/MIT",
        },
      },
      servers: [
        {
          url: config.PUBLIC_API_URL,
          description: "Haggles Facilitator API",
        },
      ],
      tags: [
        { name: "system", description: "Health and readiness endpoints" },
        { name: "protocol", description: "Haggles HTTP 402 facilitator protocol endpoints" },
        { name: "portal", description: "Authenticated portal buyer and seller endpoints" },
        { name: "webhooks", description: "PayPal webhook receiver" },
      ],
    },
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return sendProblem(
      reply,
      config.PUBLIC_API_URL,
      "not_found",
      `Route ${request.method} ${request.url} not found.`,
      request.id,
      404,
    );
  });

  app.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number }, request, reply) => {
    if (error instanceof HagglesError) {
      return sendProblem(
        reply,
        config.PUBLIC_API_URL,
        error.code,
        error.message,
        request.id,
        error.status,
      );
    }

    if (error.validation) {
      return sendProblem(
        reply,
        config.PUBLIC_API_URL,
        "invalid_challenge",
        error.message || "Request validation failed.",
        request.id,
        422,
      );
    }

    if (error.statusCode === 429) {
      return sendProblem(
        reply,
        config.PUBLIC_API_URL,
        "rate_limited",
        "Too many requests. Please retry after the Retry-After interval.",
        request.id,
        429,
      );
    }

    request.log.error({ err: error, request_id: request.id }, "Unhandled internal error");
    return sendProblem(
      reply,
      config.PUBLIC_API_URL,
      "internal_error",
      "An unexpected error occurred.",
      request.id,
      500,
    );
  });

  const facilitator = options.facilitator ?? (await FacilitatorService.create(config));

  await registerHealthRoutes(app, {
    dbHandle: options.dbHandle,
    checkReady: options.checkReady,
  });

  await registerProtocolRoutes(app, facilitator);
  await registerPortalRoutes(app, facilitator, config);

  return app;
}

