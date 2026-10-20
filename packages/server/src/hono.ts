/**
 * `@haggles/server/hono` — Hono paywall middleware adapter (SPEC.md sections 4.10 and 10.3).
 *
 * Automatically forwards Hono's matched route pattern (`c.req.routePath`) to the facilitator
 * on redeem and triggers an asynchronous auto-refund when the downstream handler throws or returns HTTP `>= 500`.
 */

import { HEADERS } from "@haggles/core";
import {
  createPaywallCore,
  type PaywallConfig,
  type PaywallCore,
  type PaywallRouteOptions,
} from "./index.js";

/**
 * Structural Hono-compatible `Context` interface.
 *
 * @example
 * ```ts
 * app.get("/datasets/rent-index", pay({ price: "0.03" }), (c) => c.json({ ok: true }));
 * ```
 */
export interface HonoLikeContext {
  req: {
    method: string;
    url: string;
    routePath?: string | undefined;
    header(name: string): string | undefined;
  };
  res: Response;
  header(name: string, value: string): void;
}

/**
 * Hono middleware handler `(c, next) => Promise<Response | void>`.
 *
 * @example
 * ```ts
 * const mw: HonoPaywallMiddleware = pay({ price: "0.03" });
 * ```
 */
export type HonoPaywallMiddleware = (
  c: HonoLikeContext,
  next: () => Promise<void>,
) => Promise<Response | void>;

/**
 * Factory returned by {@link paywall} for Hono apps.
 *
 * @example
 * ```ts
 * const pay = paywall(config);
 * app.get("/datasets/rent-index", pay({ price: "0.03", description: "Rent index" }), handler);
 * ```
 */
export interface HonoPaywallFactory {
  (options: PaywallRouteOptions): HonoPaywallMiddleware;
  /** Underlying {@link PaywallCore} instance */
  readonly core: PaywallCore;
  /** Waits for any in-flight asynchronous auto-refunds to complete */
  flushPendingRefunds(): Promise<void>;
}

/**
 * Creates a Hono paywall middleware factory (`SPEC.md` sections 4.10 and 10.3).
 *
 * @param config - Seller paywall configuration
 * @returns {@link HonoPaywallFactory}
 *
 * @example
 * ```ts
 * import { paywall } from "@haggles/server/hono";
 *
 * const pay = paywall({
 *   sellerKey: process.env.HAGGLES_SELLER_KEY!,
 *   sellerId: process.env.HAGGLES_SELLER_ID!,
 *   publicBaseUrl: "https://datasets.example.com",
 *   facilitatorUrl: "https://api.haggles.example.com",
 * });
 *
 * app.get("/datasets/rent-index", pay({ price: "0.03", description: "Rent index" }), handler);
 * ```
 */
export function paywall(config: PaywallConfig): HonoPaywallFactory {
  const core = createPaywallCore(config);

  const factory = ((options: PaywallRouteOptions): HonoPaywallMiddleware => {
    // Validate price at startup (SPEC.md section 10.3)
    const validated = core.validateRouteOptions(options);

    return async (c, next) => {
      const parsedUrl = new URL(c.req.url, config.publicBaseUrl);
      const pathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`;
      const paymentHeader = c.req.header(HEADERS.payment);
      const routePattern = validated.route ?? c.req.routePath;

      const decision = await core.verifyAndRedeem(
        {
          method: c.req.method,
          pathAndQuery,
          paymentHeader,
          route: routePattern,
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
        await next();
      } catch (err) {
        if (core.refundOnError) {
          core.enqueueAutoRefund(decision.paymentId);
        }
        throw err;
      }

      if (c.res && c.res.status >= 500 && core.refundOnError) {
        core.enqueueAutoRefund(decision.paymentId);
      }

      c.header(HEADERS.receipt, decision.receipt);
      return undefined;
    };
  }) as HonoPaywallFactory;

  Object.defineProperty(factory, "core", { value: core, enumerable: true });
  Object.defineProperty(factory, "flushPendingRefunds", {
    value: () => core.flushPendingRefunds(),
    enumerable: true,
  });

  return factory;
}
