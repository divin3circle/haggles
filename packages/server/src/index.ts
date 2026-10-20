/**
 * `@haggles/server` — Haggles seller SDK core on Web-standard `Request`/`Response` (SPEC.md sections 4.10 and 10.3).
 *
 * Implements local Ed25519 JWS payment token verification with cached JWKS (10 s refresh cooldown on unknown `kid`),
 * online single-use redemption (`POST /v1/payments/{id}/redeem`, 2 s timeout + 1 retry), fail-closed `503` on facilitator
 * unavailability, and automatic fire-and-forget refund (`POST /v1/payments/{id}/refund`) when the seller handler throws
 * or returns HTTP `>= 500`.
 */

import {
  type Challenge,
  canonicalizeUrl,
  createId,
  encodeChallenge,
  formatMoney,
  HagglesError,
  HEADERS,
  InvalidMoneyError,
  parseMoney,
  PAYMENT_TOKEN_TYP,
  PaymentTokenClaimsSchema,
  PROTOCOL_VERSION,
} from "@haggles/core";
import { compactVerify, decodeProtectedHeader, importJWK, type JWK } from "jose";

const PRICE_MIN_MICROS = 100n; // $0.000100
const PRICE_MAX_MICROS = 5_000_000n; // $5.00
const JWKS_REFRESH_COOLDOWN_MS = 10_000; // SPEC 4.10 rule 2: at most once per 10 s
const REDEEM_TIMEOUT_MS = 2_000; // SPEC 4.10 rule 3: 2 s timeout

/**
 * Event passed to `onPayment` when a paid request is redeemed (SPEC.md section 10.3).
 *
 * @example
 * ```ts
 * const onPayment = (e: SellerPaymentEvent) => console.log(e.paymentId, e.sellerNet);
 * ```
 */
export interface SellerPaymentEvent {
  paymentId: string;
  amount: string;
  sellerNet: string;
  method: string;
  url: string;
  route?: string | undefined;
}

/**
 * Configuration options for {@link createPaywallCore} and framework adapters (SPEC.md section 10.3).
 *
 * @example
 * ```ts
 * const core = createPaywallCore({
 *   sellerKey: process.env.HAGGLES_SELLER_KEY!,
 *   sellerId: process.env.HAGGLES_SELLER_ID!,
 *   publicBaseUrl: "https://poems.example.com",
 *   facilitatorUrl: "https://api.haggles.example.com",
 * });
 * ```
 */
export interface PaywallConfig {
  /** Seller API key (`hgs_<env>_...`) */
  sellerKey: string;
  /** Seller ID (`slr_...`) */
  sellerId: string;
  /** Public base URL of this seller server (`https://poems.example.com`, required per SPEC.md section 4.3) */
  publicBaseUrl: string;
  /** Facilitator base URL (defaults to `process.env.HAGGLES_FACILITATOR_URL` or `"http://localhost:3001"`) */
  facilitatorUrl?: string | undefined;
  /** Whether to automatically refund a captured payment if the route handler throws or returns `>= 500` (default `true`, SPEC.md section 4.10 rule 5) */
  refundOnError?: boolean | undefined;
  /** Injectable `fetch` implementation for tests (default `globalThis.fetch`) */
  fetch?: typeof globalThis.fetch | undefined;
  /** Optional hook invoked after a payment is successfully redeemed */
  onPayment?: ((event: SellerPaymentEvent) => void) | undefined;
  /** Optional hook invoked when a facilitator or refund error occurs */
  onError?: ((error: Error, context?: { paymentId?: string | undefined }) => void) | undefined;
}

/**
 * Per-route pricing and metadata options (SPEC.md section 10.3).
 *
 * @example
 * ```ts
 * const routeOpts: PaywallRouteOptions = { price: "0.02", description: "One poem" };
 * ```
 */
export interface PaywallRouteOptions {
  /** Route price in USD decimal string (`"0.02"`), validated at startup (`0.000100..5.00`) */
  price: string;
  /** Optional human-readable description included in the `402` challenge (max 200 chars) */
  description?: string | undefined;
  /** Optional framework route pattern (e.g. `"/poems/:id"`) sent to facilitator redeem */
  route?: string | undefined;
}

/**
 * Decision returned by `core.verifyAndRedeem` before executing the seller's route handler.
 *
 * @example
 * ```ts
 * const decision = await core.verifyAndRedeem({ method: "GET", pathAndQuery: "/poems/42", paymentHeader: undefined }, validatedRoute);
 * ```
 */
export type PaywallDecision =
  | {
      kind: "respond";
      status: 402 | 503;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    }
  | {
      kind: "proceed";
      paymentId: string;
      receipt: string;
      amount: string;
      sellerNet: string;
    };

/**
 * Pre-validated route configuration produced at startup by `core.validateRouteOptions`.
 *
 * @example
 * ```ts
 * const validated = core.validateRouteOptions({ price: "0.02" });
 * ```
 */
export interface ValidatedRouteConfig {
  priceMicros: bigint;
  formattedPrice: string;
  description?: string | undefined;
  route?: string | undefined;
}

/**
 * Framework-agnostic paywall core returned by {@link createPaywallCore} (SPEC.md section 10.3).
 *
 * @example
 * ```ts
 * const core = createPaywallCore(config);
 * const handler = core.protect({ price: "0.02" }, async (req) => new Response("Hello"));
 * ```
 */
export interface PaywallCore {
  /** Validates route price and options at startup so misconfiguration fails fast */
  validateRouteOptions(options: PaywallRouteOptions): ValidatedRouteConfig;
  /** Verifies and redeems a request, returning either an early `402`/`503` response descriptor or `"proceed"` */
  verifyAndRedeem(
    req: {
      method: string;
      pathAndQuery: string;
      paymentHeader: string | undefined;
      route?: string | undefined;
    },
    routeConfig: ValidatedRouteConfig,
  ): Promise<PaywallDecision>;
  /** Enqueues an asynchronous auto-refund for a captured payment (SPEC.md section 4.10 rule 5) */
  enqueueAutoRefund(paymentId: string): void;
  /** Waits for all in-flight asynchronous auto-refund tasks to finish (useful in tests and graceful shutdown) */
  flushPendingRefunds(): Promise<void>;
  /** Wraps a Web-standard `(req: Request) => Promise<Response> | Response` handler with the Haggles paywall */
  protect(
    options: PaywallRouteOptions,
    handler: (request: Request) => Promise<Response> | Response,
  ): (request: Request) => Promise<Response>;
  /** Whether `refundOnError` is enabled */
  readonly refundOnError: boolean;
}

/**
 * Validates a route price string at startup (`0.000100..5.00`, SPEC.md sections 2.3 and 10.3).
 *
 * @param price - Decimal USD string
 * @returns `{ priceMicros, formattedPrice }`
 *
 * @example
 * ```ts
 * const { formattedPrice } = validateStartupPrice("0.02");
 * ```
 */
export function validateStartupPrice(price: string): {
  priceMicros: bigint;
  formattedPrice: string;
} {
  const micros = parseMoney(price);
  if (micros < PRICE_MIN_MICROS || micros > PRICE_MAX_MICROS) {
    throw new InvalidMoneyError(
      `Route price $${formatMoney(micros)} is outside allowed limits ($${formatMoney(PRICE_MIN_MICROS)}..$${formatMoney(PRICE_MAX_MICROS)}).`,
    );
  }
  return {
    priceMicros: micros,
    formattedPrice: formatMoney(micros),
  };
}

/**
 * Creates a framework-agnostic Haggles paywall core (`SPEC.md` sections 4.10 and 10.3).
 *
 * @param config - Seller paywall configuration
 * @returns {@link PaywallCore} instance
 *
 * @example
 * ```ts
 * const core = createPaywallCore({
 *   sellerKey: process.env.HAGGLES_SELLER_KEY!,
 *   sellerId: process.env.HAGGLES_SELLER_ID!,
 *   publicBaseUrl: "https://poems.example.com",
 * });
 * ```
 */
export function createPaywallCore(config: PaywallConfig): PaywallCore {
  if (!config.sellerKey || !config.sellerKey.startsWith("hgs_")) {
    throw new HagglesError(
      'Invalid sellerKey: expected a seller API key starting with "hgs_".',
      { code: "unauthorized", status: 401 },
    );
  }
  if (!config.sellerId || !config.sellerId.startsWith("slr_")) {
    throw new HagglesError(
      'Invalid sellerId: expected a seller ID starting with "slr_".',
      { code: "invalid_challenge", status: 422 },
    );
  }
  if (!config.publicBaseUrl) {
    throw new HagglesError("publicBaseUrl is required for canonical URL construction.", {
      code: "invalid_challenge",
      status: 422,
    });
  }

  // Validate publicBaseUrl at startup
  const publicBase = canonicalizeUrl(config.publicBaseUrl).replace(/\/$/, "");
  const facilitatorBase = (
    config.facilitatorUrl ??
    process.env.HAGGLES_FACILITATOR_URL ??
    "http://localhost:3001"
  ).replace(/\/$/, "");
  const refundOnError = config.refundOnError ?? true;
  const fetchImpl = config.fetch ?? globalThis.fetch;

  const jwksCache = new Map<string, JWK>();
  let lastJwksFetchMs = 0;
  const pendingRefunds = new Set<Promise<void>>();

  const refreshJwksIfAllowed = async (forceInitial: boolean): Promise<void> => {
    const nowMs = Date.now();
    if (!forceInitial && nowMs - lastJwksFetchMs < JWKS_REFRESH_COOLDOWN_MS) {
      return;
    }
    lastJwksFetchMs = nowMs;
    const res = await fetchImpl(`${facilitatorBase}/.well-known/jwks.json`, {
      method: "GET",
      signal: AbortSignal.timeout(REDEEM_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`JWKS fetch failed with HTTP ${res.status}`);
    }
    const body = (await res.json()) as { keys?: Array<JWK & { kid?: string }> };
    if (Array.isArray(body.keys)) {
      jwksCache.clear();
      for (const k of body.keys) {
        if (k.kid) {
          jwksCache.set(k.kid, k);
        }
      }
    }
  };

  const buildFresh402 = (
    method: string,
    canonicalUrl: string,
    routeConfig: ValidatedRouteConfig,
  ): Extract<PaywallDecision, { kind: "respond" }> => {
    const now = Date.now();
    const challenge: Challenge = {
      protocol: "haggles",
      version: PROTOCOL_VERSION,
      scheme: "prepaid-usd",
      challenge_id: createId("chl", now),
      amount: routeConfig.formattedPrice,
      currency: "USD",
      method: method.toUpperCase(),
      url: canonicalUrl,
      seller_id: config.sellerId,
      ...(routeConfig.description ? { description: routeConfig.description } : {}),
      facilitator: facilitatorBase,
      expires_at: new Date(now + 60_000).toISOString(),
    };
    const encoded = encodeChallenge(challenge);
    return {
      kind: "respond",
      status: 402,
      headers: {
        [HEADERS.required]: encoded,
        "cache-control": "no-store",
        vary: "Haggles-Payment",
        "content-type": "application/json; charset=utf-8",
      },
      body: challenge as unknown as Record<string, unknown>,
    };
  };

  const build503Unavailable = (): Extract<PaywallDecision, { kind: "respond" }> => ({
    kind: "respond",
    status: 503,
    headers: {
      "retry-after": "2",
      "content-type": "application/problem+json",
    },
    body: {
      type: `${facilitatorBase}/errors/facilitator_unavailable`,
      title: "Facilitator unavailable",
      status: 503,
      code: "facilitator_unavailable",
      detail: "Payment facilitator could not be reached to redeem the payment token. Please retry.",
    },
  });

  const verifyTokenLocally = async (
    token: string,
    expectedMethod: string,
    expectedCanonicalUrl: string,
    expectedAmount: string,
  ): Promise<{ paymentId: string } | null> => {
    try {
      const header = decodeProtectedHeader(token);
      if (
        header.alg !== "EdDSA" ||
        header.typ !== PAYMENT_TOKEN_TYP ||
        typeof header.kid !== "string"
      ) {
        return null;
      }

      if (jwksCache.size === 0) {
        await refreshJwksIfAllowed(true);
      } else if (!jwksCache.has(header.kid)) {
        await refreshJwksIfAllowed(false);
      }

      const jwk = jwksCache.get(header.kid);
      if (!jwk) {
        return null;
      }

      const publicKey = await importJWK(jwk, "EdDSA");
      const { payload } = await compactVerify(token, publicKey, {
        algorithms: ["EdDSA"],
      });
      const decoded = JSON.parse(new TextDecoder().decode(payload)) as unknown;
      const parsed = PaymentTokenClaimsSchema.safeParse(decoded);
      if (!parsed.success) {
        return null;
      }
      const claims = parsed.data;
      const nowSec = Math.floor(Date.now() / 1000);

      if (
        claims.iss.replace(/\/$/, "") !== facilitatorBase ||
        claims.aud !== config.sellerId ||
        claims.exp <= nowSec ||
        claims.method.toUpperCase() !== expectedMethod.toUpperCase() ||
        canonicalizeUrl(claims.url) !== expectedCanonicalUrl ||
        parseMoney(claims.amount) !== parseMoney(expectedAmount)
      ) {
        return null;
      }

      return { paymentId: claims.sub };
    } catch {
      return null;
    }
  };

  const validateRouteOptions = (options: PaywallRouteOptions): ValidatedRouteConfig => {
    const { priceMicros, formattedPrice } = validateStartupPrice(options.price);
    return {
      priceMicros,
      formattedPrice,
      description: options.description,
      route: options.route,
    };
  };

  const verifyAndRedeem = async (
    req: {
      method: string;
      pathAndQuery: string;
      paymentHeader: string | undefined;
      route?: string | undefined;
    },
    routeConfig: ValidatedRouteConfig,
  ): Promise<PaywallDecision> => {
    const normalizedPath = req.pathAndQuery.startsWith("/")
      ? req.pathAndQuery
      : `/${req.pathAndQuery}`;
    const canonicalUrl = canonicalizeUrl(`${publicBase}${normalizedPath}`);
    const method = req.method.toUpperCase();

    // SPEC 4.10 rule 1: No Haggles-Payment header -> 402 with fresh challenge
    if (!req.paymentHeader || req.paymentHeader.trim().length === 0) {
      return buildFresh402(method, canonicalUrl, routeConfig);
    }

    const token = req.paymentHeader.trim();

    // SPEC 4.10 rule 2: Verify locally via cached JWKS; any failure -> fresh 402 (never 500)
    const verified = await verifyTokenLocally(
      token,
      method,
      canonicalUrl,
      routeConfig.formattedPrice,
    );
    if (!verified) {
      return buildFresh402(method, canonicalUrl, routeConfig);
    }

    // SPEC 4.10 rule 3: POST /v1/payments/{id}/redeem with timeout 2 s and 1 retry with same Idempotency-Key
    const redeemIdempotencyKey = `red_${verified.paymentId}`;
    const routePattern = req.route ?? routeConfig.route;
    const redeemUrl = `${facilitatorBase}/v1/payments/${encodeURIComponent(verified.paymentId)}/redeem`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(redeemUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.sellerKey}`,
            "content-type": "application/json",
            "idempotency-key": redeemIdempotencyKey,
          },
          body: JSON.stringify({
            token,
            method,
            url: canonicalUrl,
            amount: routeConfig.formattedPrice,
            ...(routePattern ? { route: routePattern } : {}),
          }),
          signal: AbortSignal.timeout(REDEEM_TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt === 1) continue;
        config.onError?.(
          err instanceof Error ? err : new Error(String(err)),
          { paymentId: verified.paymentId },
        );
        return build503Unavailable();
      }

      if (res.status === 200) {
        const body = (await res.json()) as {
          payment_id: string;
          status: "captured";
          amount: string;
          seller_net: string;
          receipt: string;
        };
        config.onPayment?.({
          paymentId: body.payment_id,
          amount: body.amount,
          sellerNet: body.seller_net,
          method,
          url: canonicalUrl,
          route: routePattern,
        });
        return {
          kind: "proceed",
          paymentId: body.payment_id,
          receipt: body.receipt,
          amount: body.amount,
          sellerNet: body.seller_net,
        };
      }

      if (res.status === 404 || res.status === 409 || res.status === 410 || res.status === 422) {
        // SPEC 4.10 rule 3: already_redeemed, amount_mismatch, 404/410 -> fresh 402
        return buildFresh402(method, canonicalUrl, routeConfig);
      }

      // 5xx or 401/403 facilitator error -> retry once, then fail closed 503
      if (attempt === 2) {
        config.onError?.(
          new Error(`Facilitator redeem returned HTTP ${res.status}`),
          { paymentId: verified.paymentId },
        );
        return build503Unavailable();
      }
    }

    return build503Unavailable();
  };

  const enqueueAutoRefund = (paymentId: string): void => {
    const task = (async () => {
      const refundUrl = `${facilitatorBase}/v1/payments/${encodeURIComponent(paymentId)}/refund`;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetchImpl(refundUrl, {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.sellerKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ reason: "handler_error" }),
            signal: AbortSignal.timeout(REDEEM_TIMEOUT_MS),
          });
          if (res.ok) return;
        } catch (err) {
          if (attempt === 2) {
            config.onError?.(
              err instanceof Error ? err : new Error(String(err)),
              { paymentId },
            );
          }
        }
      }
    })();

    pendingRefunds.add(task);
    void task.finally(() => {
      pendingRefunds.delete(task);
    });
  };

  const flushPendingRefunds = async (): Promise<void> => {
    await Promise.allSettled(Array.from(pendingRefunds));
  };

  const protect = (
    options: PaywallRouteOptions,
    handler: (request: Request) => Promise<Response> | Response,
  ): ((request: Request) => Promise<Response>) => {
    const validated = validateRouteOptions(options);

    return async (request: Request): Promise<Response> => {
      const parsedUrl = new URL(request.url, publicBase);
      const pathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`;
      const paymentHeader = request.headers.get(HEADERS.payment) ?? undefined;

      const decision = await verifyAndRedeem(
        {
          method: request.method,
          pathAndQuery,
          paymentHeader,
          route: validated.route,
        },
        validated,
      );

      if (decision.kind === "respond") {
        return new Response(JSON.stringify(decision.body), {
          status: decision.status,
          headers: decision.headers,
        });
      }

      try {
        const res = await handler(request);
        if (res.status >= 500 && refundOnError) {
          enqueueAutoRefund(decision.paymentId);
        }
        const headers = new Headers(res.headers);
        headers.set(HEADERS.receipt, decision.receipt);
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      } catch (err) {
        if (refundOnError) {
          enqueueAutoRefund(decision.paymentId);
        }
        throw err;
      }
    };
  };

  return {
    validateRouteOptions,
    verifyAndRedeem,
    enqueueAutoRefund,
    flushPendingRefunds,
    protect,
    refundOnError,
  };
}
