/**
 * `@haggles/server/express` — Express paywall middleware adapter (SPEC.md sections 4.10 and 10.3).
 *
 * Automatically forwards the Express route pattern (`req.baseUrl + req.route.path`) to the facilitator
 * on redeem and triggers an asynchronous auto-refund when the downstream handler throws or sends HTTP `>= 500`.
 */

import { HEADERS } from "@haggles/core";
import {
  createPaywallCore,
  type PaywallConfig,
  type PaywallCore,
  type PaywallRouteOptions,
} from "./index.js";

/**
 * Structural Express-compatible `Request` interface so `@haggles/server/express` works across Express 4 and 5 without version conflicts.
 *
 * @example
 * ```ts
 * app.get("/poems/:id", pay({ price: "0.02" }), (req, res) => res.json({ poem: "..." }));
 * ```
 */
export interface ExpressLikeRequest {
  method: string;
  originalUrl?: string | undefined;
  url: string;
  baseUrl?: string | undefined;
  route?: { path?: string | undefined } | undefined;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Structural Express-compatible `Response` interface.
 *
 * @example
 * ```ts
 * res.status(200).json({ ok: true });
 * ```
 */
export interface ExpressLikeResponse {
  statusCode: number;
  status(code: number): this;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
  once?(event: "finish", listener: () => void): unknown;
}

/**
 * Express middleware function signature `(req, res, next)`.
 *
 * @example
 * ```ts
 * const mw: ExpressPaywallMiddleware = pay({ price: "0.02" });
 * ```
 */
export type ExpressPaywallMiddleware = (
  req: ExpressLikeRequest,
  res: ExpressLikeResponse,
  next: (err?: unknown) => void,
) => Promise<void>;

/**
 * Factory returned by {@link paywall} for Express apps.
 *
 * @example
 * ```ts
 * const pay = paywall(config);
 * app.get("/poems/:id", pay({ price: "0.02", description: "One poem" }), handler);
 * ```
 */
export interface ExpressPaywallFactory {
  (options: PaywallRouteOptions): ExpressPaywallMiddleware;
  /** Underlying {@link PaywallCore} instance */
  readonly core: PaywallCore;
  /** Waits for any in-flight asynchronous auto-refunds to complete */
  flushPendingRefunds(): Promise<void>;
}

/**
 * Creates an Express paywall middleware factory (`SPEC.md` sections 4.10 and 10.3).
 *
 * @param config - Seller paywall configuration
 * @returns {@link ExpressPaywallFactory}
 *
 * @example
 * ```ts
 * import { paywall } from "@haggles/server/express";
 *
 * const pay = paywall({
 *   sellerKey: process.env.HAGGLES_SELLER_KEY!,
 *   sellerId: process.env.HAGGLES_SELLER_ID!,
 *   publicBaseUrl: "https://poems.example.com",
 *   facilitatorUrl: "https://api.haggles.example.com",
 * });
 *
 * app.get("/poems/:id", pay({ price: "0.02", description: "One poem" }), handler);
 * ```
 */
export function paywall(config: PaywallConfig): ExpressPaywallFactory {
  const core = createPaywallCore(config);

  const factory = ((options: PaywallRouteOptions): ExpressPaywallMiddleware => {
    // Validate price at startup (SPEC.md section 10.3)
    const validated = core.validateRouteOptions(options);

    return async (req, res, next) => {
      const rawPaymentHeader = req.headers[HEADERS.payment];
      const paymentHeader = Array.isArray(rawPaymentHeader)
        ? rawPaymentHeader[0]
        : rawPaymentHeader;
      const pathAndQuery = req.originalUrl ?? req.url;
      const expressRoutePattern =
        validated.route ??
        (req.route?.path ? `${req.baseUrl ?? ""}${req.route.path}` : undefined);

      const decision = await core.verifyAndRedeem(
        {
          method: req.method,
          pathAndQuery,
          paymentHeader,
          route: expressRoutePattern,
        },
        validated,
      );

      if (decision.kind === "respond") {
        for (const [k, v] of Object.entries(decision.headers)) {
          res.setHeader(k, v);
        }
        res.status(decision.status).json(decision.body);
        return;
      }

      // Attach Haggles-Receipt header before running downstream handler (SPEC 4.10 rule 4)
      res.setHeader(HEADERS.receipt, decision.receipt);

      let refunded = false;
      const triggerRefundOnce = (): void => {
        if (!refunded && core.refundOnError) {
          refunded = true;
          core.enqueueAutoRefund(decision.paymentId);
        }
      };

      res.once?.("finish", () => {
        if (res.statusCode >= 500) {
          triggerRefundOnce();
        }
      });

      try {
        next();
      } catch (err) {
        triggerRefundOnce();
        next(err);
      }
    };
  }) as ExpressPaywallFactory;

  Object.defineProperty(factory, "core", { value: core, enumerable: true });
  Object.defineProperty(factory, "flushPendingRefunds", {
    value: () => core.flushPendingRefunds(),
    enumerable: true,
  });

  return factory;
}
