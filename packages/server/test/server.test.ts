/**
 * `@haggles/server` unit and end-to-end integration tests with `@haggles/client` and `@haggles/api`
 * (SPEC.md sections 4.7, 4.9, 4.10, 10.2, 10.3, 15.1).
 */

import { buildApp, FacilitatorService, loadConfig } from "@haggles/api";
import { createHaggles, readReceipt } from "@haggles/client";
import { decodeChallenge, HEADERS, InvalidMoneyError } from "@haggles/core";
import { describe, expect, it } from "vitest";
import { paywall as expressPaywall } from "../src/express.js";
import { paywall as honoPaywall } from "../src/hono.js";
import { createPaywallCore } from "../src/index.js";

/**
 * Bridges global `fetch` URLs to a Fastify `app.inject()` instance and an in-memory seller handler.
 */
function createInProcessFetch(params: {
  facilitatorOrigin: string;
  app: Awaited<ReturnType<typeof buildApp>>;
  sellerOrigin: string;
  sellerHandler: (req: Request) => Promise<Response>;
}): typeof globalThis.fetch {
  return async (input, init) => {
    const req = input instanceof Request ? input : new Request(input.toString(), init);
    const url = new URL(req.url);

    if (url.origin === params.facilitatorOrigin) {
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const payload =
        req.method !== "GET" && req.method !== "HEAD" ? await req.text() : undefined;
      const injected = await params.app.inject({
        method: req.method as "GET" | "POST",
        url: `${url.pathname}${url.search}`,
        headers,
        ...(payload !== undefined ? { payload } : {}),
      });
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(injected.headers)) {
        if (typeof v === "string") resHeaders.set(k, v);
      }
      return new Response(injected.body, {
        status: injected.statusCode,
        headers: resHeaders,
      });
    }

    if (url.origin === params.sellerOrigin) {
      return params.sellerHandler(req);
    }

    throw new Error(`Unexpected origin in test fetch: ${url.origin}`);
  };
}

describe("@haggles/server — Startup Validation, Core, Express & Hono Adapters, and E2E with @haggles/client (SPEC.md 4.10, 10.3)", () => {
  it("validates route prices at startup so misconfiguration fails fast (SPEC.md 10.3)", () => {
    const core = createPaywallCore({
      sellerKey: "hgs_test_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg",
      sellerId: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
      publicBaseUrl: "https://poems.example.com",
    });

    expect(() => core.validateRouteOptions({ price: "0.00" })).toThrow(InvalidMoneyError);
    expect(() => core.validateRouteOptions({ price: "9.99" })).toThrow(InvalidMoneyError);
    expect(() => core.validateRouteOptions({ price: "not-a-number" })).toThrow(InvalidMoneyError);
    expect(core.validateRouteOptions({ price: "0.0200" }).formattedPrice).toBe("0.02");
  });

  it("completes full end-to-end 402 flow between @haggles/client, @haggles/server, and @haggles/api facilitator", async () => {
    const facilitatorOrigin = "https://api.haggles.example.com";
    const sellerOrigin = "https://poems.example.com";
    const config = loadConfig({
      LOG_LEVEL: "silent",
      PUBLIC_API_URL: facilitatorOrigin,
    });
    const facilitator = await FacilitatorService.create(config);
    const app = await buildApp({ config, facilitator });

    // Seed buyer wallet ($5.00) + agent key, and seller + seller key
    const wallet = facilitator.createWallet("acc_buyer_e2e");
    facilitator.creditWalletTopup({
      walletId: wallet.id,
      topupId: "top_e2e_1",
      grossAmountMicros: 5_000_000n,
      paypalFeeMicros: 50_000n,
    });
    const { fullKey: agentKey } = facilitator.createAgentKey({
      walletId: wallet.id,
      name: "Research Agent",
      perCallMaxMicros: 100_000n,
      dailyMaxMicros: 500_000n,
    });

    const seller = facilitator.createSeller({
      accountId: "acc_seller_e2e",
      payoutPaypalPayerId: "PAYER_SELLER_E2E",
      payoutEmail: "poems@example.com",
    });
    const { fullKey: sellerKey } = facilitator.createSellerKey({
      sellerId: seller.id,
      name: "Poems Server",
    });

    let currentSellerHandler: (req: Request) => Promise<Response> = async () =>
      new Response("uninitialized", { status: 500 });

    const routedFetch = createInProcessFetch({
      facilitatorOrigin,
      app,
      sellerOrigin,
      sellerHandler: (req) => currentSellerHandler(req),
    });

    const paywallCore = createPaywallCore({
      sellerKey,
      sellerId: seller.id,
      publicBaseUrl: sellerOrigin,
      facilitatorUrl: facilitatorOrigin,
      fetch: routedFetch,
    });

    currentSellerHandler = paywallCore.protect(
      { price: "0.02", description: "One poem", route: "/poems/:id" },
      async (req) => {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/boom")) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response(JSON.stringify({ id: "42", text: "Hope is the thing with feathers" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );

    const haggles = createHaggles({
      agentKey,
      facilitatorUrl: facilitatorOrigin,
      fetch: routedFetch,
    });

    // 1. Paid call succeeds, returns 200 + Haggles-Receipt, and debits $0.02 from buyer wallet
    const res = await haggles.fetch("https://poems.example.com/poems/42");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string; text: string };
    expect(data.id).toBe("42");

    const receipt = readReceipt(res);
    expect(receipt).not.toBeNull();
    expect(receipt?.amount).toBe("0.02");
    expect(receipt?.sellerId).toBe(seller.id);

    const balAfterSuccess = await haggles.balance();
    expect(balAfterSuccess.available).toBe("4.98");
    expect(balAfterSuccess.held).toBe("0.00");

    // Auto-discovered endpoint `/poems/:id` was registered on capture
    const endpoints = facilitator.getSellerEndpoints(seller.id);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]?.route).toBe("/poems/:id");

    // 2. When seller handler returns 500, middleware automatically refunds the buyer (SPEC 4.10 rule 5)
    const errRes = await haggles.fetch("https://poems.example.com/poems/boom");
    expect(errRes.status).toBe(500);
    await paywallCore.flushPendingRefunds();

    const balAfterRefund = await haggles.balance();
    expect(balAfterRefund.available).toBe("4.98");
    expect(balAfterRefund.held).toBe("0.00");

    // 3. Forged or tampered Haggles-Payment token returns fresh 402 (never 500, SPEC 4.10 rule 2)
    const forgedRes = await routedFetch("https://poems.example.com/poems/42", {
      headers: { [HEADERS.payment]: "eyJhbGciOiJFZERTQSJ9.tampered.sig" },
    });
    expect(forgedRes.status).toBe(402);
    expect(decodeChallenge(forgedRes.headers.get(HEADERS.required)!).amount).toBe("0.02");

    expect(facilitator.verifyLedgerInvariants().ok).toBe(true);
    await app.close();
  });

  it("fails closed with 503 and Retry-After: 2 when facilitator redeem is unreachable or returns 5xx (SPEC 4.10 rule 3)", async () => {
    const facilitatorOrigin = "https://api.haggles.example.com";
    const sellerOrigin = "https://poems.example.com";
    const config = loadConfig({
      LOG_LEVEL: "silent",
      PUBLIC_API_URL: facilitatorOrigin,
    });
    const facilitator = await FacilitatorService.create(config);
    const app = await buildApp({ config, facilitator });

    const wallet = facilitator.createWallet("acc_buyer_503");
    facilitator.creditWalletTopup({
      walletId: wallet.id,
      topupId: "top_503_1",
      grossAmountMicros: 5_000_000n,
      paypalFeeMicros: 0n,
    });
    const { fullKey: agentKey } = facilitator.createAgentKey({
      walletId: wallet.id,
      name: "Agent 503",
    });
    const seller = facilitator.createSeller({
      accountId: "acc_seller_503",
      payoutPaypalPayerId: "PAYER_503",
      payoutEmail: "s503@example.com",
    });
    const { fullKey: sellerKey } = facilitator.createSellerKey({
      sellerId: seller.id,
      name: "Seller 503",
    });

    let simulateRedeemOutage = false;
    let handlerExecutedDuringOutage = false;

    const customFetch: typeof globalThis.fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input.toString(), init);
      const url = new URL(req.url);
      if (simulateRedeemOutage && url.pathname.endsWith("/redeem")) {
        return new Response("Facilitator DB down", { status: 503 });
      }
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const payload =
        req.method !== "GET" && req.method !== "HEAD" ? await req.text() : undefined;
      const injected = await app.inject({
        method: req.method as "GET" | "POST",
        url: `${url.pathname}${url.search}`,
        headers,
        ...(payload !== undefined ? { payload } : {}),
      });
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(injected.headers)) {
        if (typeof v === "string") resHeaders.set(k, v);
      }
      return new Response(injected.body, {
        status: injected.statusCode,
        headers: resHeaders,
      });
    };

    const paywallCore = createPaywallCore({
      sellerKey,
      sellerId: seller.id,
      publicBaseUrl: sellerOrigin,
      facilitatorUrl: facilitatorOrigin,
      fetch: customFetch,
    });

    const protectedHandler = paywallCore.protect({ price: "0.02" }, async () => {
      handlerExecutedDuringOutage = true;
      return new Response("secret paid content", { status: 200 });
    });

    // Step 1: get 402 challenge
    const challengeRes = await protectedHandler(new Request("https://poems.example.com/poems/42"));
    expect(challengeRes.status).toBe(402);
    const challenge = decodeChallenge(challengeRes.headers.get(HEADERS.required)!);

    // Step 2: authorize payment at facilitator
    const authPayment = await facilitator.authorizePayment({
      rawAgentKey: agentKey,
      idempotencyKey: challenge.challenge_id,
      challengeInput: challenge,
    });

    // Step 3: simulate facilitator outage during redeem -> seller MUST return 503 with Retry-After: 2 and never run handler
    simulateRedeemOutage = true;
    const paidAttemptRes = await protectedHandler(
      new Request("https://poems.example.com/poems/42", {
        headers: { [HEADERS.payment]: authPayment.token },
      }),
    );
    expect(paidAttemptRes.status).toBe(503);
    expect(paidAttemptRes.headers.get("retry-after")).toBe("2");
    expect(handlerExecutedDuringOutage).toBe(false);

    await app.close();
  });

  it("supports Express and Hono middleware adapters with route pattern forwarding", async () => {
    const sellerConfig = {
      sellerKey: "hgs_test_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg",
      sellerId: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
      publicBaseUrl: "https://datasets.example.com",
      facilitatorUrl: "https://api.haggles.example.com",
    };

    // Express adapter returns 402 when unpaid
    const expPay = expressPaywall(sellerConfig);
    const expMw = expPay({ price: "0.03", description: "Rent index" });
    let expStatus = 0;
    const expHeaders: Record<string, string> = {};
    let expBody: unknown = null;
    await expMw(
      {
        method: "GET",
        originalUrl: "/datasets/rent-index?city=sf",
        url: "/datasets/rent-index?city=sf",
        route: { path: "/datasets/rent-index" },
        headers: {},
      },
      {
        statusCode: 200,
        status(c) {
          expStatus = c;
          return this;
        },
        setHeader(k, v) {
          expHeaders[k.toLowerCase()] = v;
        },
        json(b) {
          expBody = b;
        },
      },
      () => {},
    );
    expect(expStatus).toBe(402);
    expect(expHeaders[HEADERS.required]).toBeDefined();
    expect((expBody as { url: string }).url).toBe(
      "https://datasets.example.com/datasets/rent-index?city=sf",
    );

    // Hono adapter returns 402 Response when unpaid
    const honoPay = honoPaywall(sellerConfig);
    const honoMw = honoPay({ price: "0.01", description: "Transit fares" });
    const honoRes = await honoMw(
      {
        req: {
          method: "GET",
          url: "https://datasets.example.com/datasets/transit-fares?city=nyc",
          routePath: "/datasets/transit-fares",
          header: () => undefined,
        },
        res: new Response(),
        header: () => {},
      },
      async () => {},
    );
    expect(honoRes).toBeInstanceOf(Response);
    expect(honoRes?.status).toBe(402);
    const challenge = decodeChallenge(honoRes!.headers.get(HEADERS.required)!);
    expect(challenge.amount).toBe("0.01");
    expect(challenge.url).toBe("https://datasets.example.com/datasets/transit-fares?city=nyc");
  });
});
