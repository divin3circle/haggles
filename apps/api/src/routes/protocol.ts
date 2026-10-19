/**
 * Haggles Protocol API routes (`/v1/*` and `/.well-known/jwks.json`, SPEC.md section 5.1).
 *
 * Every route has a TypeBox schema and an OpenAPI description (SPEC.md sections 0.2 rule 4 and 3.3).
 */

import { type Static, Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { FacilitatorService } from "../services/facilitator.js";

/**
 * Extracts a bearer token from an `Authorization: Bearer <token>` header.
 *
 * @param request - Fastify request
 * @returns Raw bearer token or `undefined`
 *
 * @example
 * ```ts
 * const key = extractBearerToken(request);
 * ```
 */
export function extractBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header || typeof header !== "string") return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}

/**
 * TypeBox schema for RFC 9457 `application/problem+json` error responses (SPEC.md section 4.11).
 */
export const ProblemDetailsSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer(),
    code: Type.String(),
    detail: Type.String(),
    request_id: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * TypeBox schema for `POST /v1/payments` request body (SPEC.md section 5.1).
 */
export const AuthorizePaymentBodySchema = Type.Object(
  {
    challenge: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

/**
 * TypeBox schema for `POST /v1/payments` `201` response body (SPEC.md section 5.1).
 */
export const AuthorizePaymentResponseSchema = Type.Object(
  {
    payment_id: Type.String(),
    token: Type.String(),
    amount: Type.String(),
    currency: Type.Literal("USD"),
    expires_at: Type.String(),
  },
  { additionalProperties: false },
);

/**
 * TypeBox schema for `POST /v1/payments/{id}/redeem` request body (SPEC.md section 5.1).
 */
export const RedeemPaymentBodySchema = Type.Object(
  {
    token: Type.String({ minLength: 1 }),
    method: Type.String({ minLength: 1 }),
    url: Type.String({ minLength: 1 }),
    amount: Type.String({ minLength: 1 }),
    route: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);

/**
 * TypeBox schema for `POST /v1/payments/{id}/redeem` `200` response body (SPEC.md section 5.1).
 */
export const RedeemPaymentResponseSchema = Type.Object(
  {
    payment_id: Type.String(),
    status: Type.Literal("captured"),
    amount: Type.String(),
    seller_net: Type.String(),
    receipt: Type.String(),
  },
  { additionalProperties: false },
);

/**
 * TypeBox schema for `POST /v1/payments/{id}/refund` request body (SPEC.md section 5.1).
 */
export const RefundPaymentBodySchema = Type.Object(
  {
    reason: Type.Union([Type.Literal("handler_error"), Type.Literal("seller_initiated")]),
  },
  { additionalProperties: false },
);

/**
 * TypeBox schema for `POST /v1/payments/{id}/refund` `200` response body (SPEC.md section 5.1).
 */
export const RefundPaymentResponseSchema = Type.Object(
  {
    payment_id: Type.String(),
    status: Type.Literal("refunded"),
    amount: Type.String(),
    refunded_at: Type.String(),
  },
  { additionalProperties: false },
);

/**
 * TypeBox schema for `GET /v1/wallet` `200` response body (SPEC.md sections 5.1 and 10.2).
 */
export const WalletSummaryResponseSchema = Type.Object(
  {
    available: Type.String(),
    held: Type.String(),
    currency: Type.Literal("USD"),
    allowance: Type.Object(
      {
        per_call_max: Type.String(),
        daily_remaining: Type.String(),
        monthly_remaining: Type.Union([Type.String(), Type.Null()]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

/**
 * TypeBox schema for `GET /.well-known/jwks.json` response body (SPEC.md section 4.6).
 */
export const JwksResponseSchema = Type.Object(
  {
    keys: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

const PaymentIdParamsSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/**
 * Registers all Haggles Protocol API routes (`/v1/*` and `/.well-known/jwks.json`, SPEC.md section 5.1).
 *
 * @param app - Fastify instance
 * @param facilitator - {@link FacilitatorService} instance
 *
 * @example
 * ```ts
 * await registerProtocolRoutes(app, facilitator);
 * ```
 */
export async function registerProtocolRoutes(
  app: FastifyInstance,
  facilitator: FacilitatorService,
): Promise<void> {
  app.get(
    "/.well-known/jwks.json",
    {
      schema: {
        tags: ["protocol"],
        summary: "Public Ed25519 signing keys (JWKS)",
        description:
          "Returns active and recently retired Ed25519 public keys used to verify payment tokens and receipts (SPEC.md section 4.6).",
        response: {
          200: JwksResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      reply.header("cache-control", "public, max-age=300");
      return facilitator.getJwks();
    },
  );

  app.post<{
    Body: Static<typeof AuthorizePaymentBodySchema>;
  }>(
    "/v1/payments",
    {
      schema: {
        tags: ["protocol"],
        summary: "Authorize a payment",
        description:
          "Validates a 402 challenge, enforces the agent key's spending policy, places a hold on the buyer wallet, and issues a short-lived Ed25519 payment token (SPEC.md section 5.1).",
        body: AuthorizePaymentBodySchema,
        response: {
          201: AuthorizePaymentResponseSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ProblemDetailsSchema,
          422: ProblemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const rawAgentKey = extractBearerToken(request);
      const idempotencyKey =
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : undefined;

      const result = await facilitator.authorizePayment({
        rawAgentKey,
        idempotencyKey,
        challengeInput: request.body.challenge,
      });
      return reply.status(201).send(result);
    },
  );

  app.get<{
    Params: Static<typeof PaymentIdParamsSchema>;
  }>(
    "/v1/payments/:id",
    {
      schema: {
        tags: ["protocol"],
        summary: "Read a payment",
        description:
          "Returns a payment for the owning agent key or seller key. Sellers receive a pseudonymous agent_ref and never buyer identity (SPEC.md sections 5.1 and 8.4).",
        params: PaymentIdParamsSchema,
        response: {
          200: Type.Record(Type.String(), Type.Unknown()),
          401: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const rawBearerKey = extractBearerToken(request);
      return facilitator.getPaymentForCaller({
        rawBearerKey,
        paymentId: request.params.id,
      });
    },
  );

  app.post<{
    Params: Static<typeof PaymentIdParamsSchema>;
    Body: Static<typeof RedeemPaymentBodySchema>;
  }>(
    "/v1/payments/:id/redeem",
    {
      schema: {
        tags: ["protocol"],
        summary: "Redeem (capture) an authorized payment",
        description:
          "Verifies the payment token, atomically transitions the payment from authorized to captured, credits the seller net of platform fee, and returns a signed receipt (SPEC.md section 5.1).",
        params: PaymentIdParamsSchema,
        body: RedeemPaymentBodySchema,
        response: {
          200: RedeemPaymentResponseSchema,
          401: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ProblemDetailsSchema,
          410: ProblemDetailsSchema,
          422: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const rawSellerKey = extractBearerToken(request);
      const idempotencyKey =
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : undefined;

      return facilitator.redeemPayment({
        rawSellerKey,
        idempotencyKey,
        paymentId: request.params.id,
        token: request.body.token,
        method: request.body.method,
        url: request.body.url,
        amount: request.body.amount,
        route: request.body.route,
      });
    },
  );

  app.post<{
    Params: Static<typeof PaymentIdParamsSchema>;
    Body: Static<typeof RefundPaymentBodySchema>;
  }>(
    "/v1/payments/:id/refund",
    {
      schema: {
        tags: ["protocol"],
        summary: "Refund a captured payment",
        description:
          "Refunds a captured payment within 24 hours, returning the gross amount (including platform fee) to the buyer wallet's available balance (SPEC.md sections 5.1, 6.3, 7.4).",
        params: PaymentIdParamsSchema,
        body: RefundPaymentBodySchema,
        response: {
          200: RefundPaymentResponseSchema,
          401: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const rawSellerKey = extractBearerToken(request);
      return facilitator.refundPayment({
        rawSellerKey,
        paymentId: request.params.id,
        reason: request.body.reason,
      });
    },
  );

  app.get(
    "/v1/wallet",
    {
      schema: {
        tags: ["protocol"],
        summary: "Read buyer wallet balance and policy allowance",
        description:
          "Returns available and held USD balance plus remaining per-call, daily, and monthly policy allowances for the authenticated agent key (SPEC.md sections 5.1 and 10.2).",
        response: {
          200: WalletSummaryResponseSchema,
          401: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const rawAgentKey = extractBearerToken(request);
      return facilitator.getWalletForAgent({ rawAgentKey });
    },
  );
}
