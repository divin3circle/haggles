/**
 * End-to-end tests for `@haggles/example-buyer-research-agent` (`SPEC.md` section 12.3).
 */

import { buildApp, FacilitatorService, loadConfig } from "@haggles/api";
import { createSellerDatasetsApp } from "@haggles/example-seller-datasets";
import { describe, expect, it } from "vitest";
import { runResearchAgent } from "../src/index.js";

describe("examples/buyer-research-agent (SPEC.md section 12.3)", () => {
  it("buys 3 sources for $0.07 and reproduces the policy_violation guardrail on demand when daily_max is exceeded", async () => {
    const facilitatorOrigin = "https://api.haggles.example.com";
    const datasetsOrigin = "https://datasets.example.com";
    const poemsOrigin = "https://poems.example.com";

    const config = loadConfig({
      LOG_LEVEL: "silent",
      PUBLIC_API_URL: facilitatorOrigin,
    });
    const facilitator = await FacilitatorService.create(config);
    const apiApp = await buildApp({ config, facilitator });

    const wallet = facilitator.createWallet("acc_buyer_research");
    facilitator.creditWalletTopup({
      walletId: wallet.id,
      topupId: "top_research_1",
      grossAmountMicros: 5_000_000n,
      paypalFeeMicros: 50_000n,
    });

    // Agent key with $0.08 daily cap so 3 sources ($0.07) succeed and a 4th ($0.03) hits daily_max_exceeded
    const { fullKey: agentKey } = facilitator.createAgentKey({
      walletId: wallet.id,
      name: "Research Agent ($0.08/day cap)",
      perCallMaxMicros: 50_000n, // $0.05/call
      dailyMaxMicros: 80_000n, // $0.08/day
    });

    const seller = facilitator.createSeller({
      accountId: "acc_seller_research",
      payoutEmail: "datasets@example.com",
      payoutPaypalPayerId: "PAYER_RESEARCH_1",
    });
    const { fullKey: sellerKey } = facilitator.createSellerKey({
      sellerId: seller.id,
      name: "Datasets Key",
    });

    let datasetsApp!: ReturnType<typeof createSellerDatasetsApp>;

    const customFetch: typeof globalThis.fetch = async (input, init) => {
      const req =
        input instanceof Request ? input : new Request(input.toString(), init);
      const url = new URL(req.url);

      if (url.origin === facilitatorOrigin) {
        const headers: Record<string, string> = {};
        req.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const payload =
          req.method !== "GET" && req.method !== "HEAD"
            ? await req.text()
            : undefined;
        const injected = await apiApp.inject({
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

      if (url.origin === datasetsOrigin) {
        return datasetsApp.fetch(req);
      }

      throw new Error(`Unexpected origin: ${url.origin}`);
    };

    datasetsApp = createSellerDatasetsApp({
      sellerId: seller.id,
      sellerKey,
      publicBaseUrl: datasetsOrigin,
      facilitatorUrl: facilitatorOrigin,
      fetch: customFetch,
    });

    // 1. Run normal 3-source query ($0.03 + $0.03 + $0.01 = $0.07)
    const run1 = await runResearchAgent(
      "Compare rent and transit costs between Austin and Chicago",
      {
        agentKey,
        facilitatorUrl: facilitatorOrigin,
        datasetsBaseUrl: datasetsOrigin,
        poemsBaseUrl: poemsOrigin,
        dailyAllowanceUsd: "0.08",
        fetch: customFetch,
      },
    );

    expect(run1.sourcesBought).toBe(3);
    expect(run1.totalSpent).toBe("0.07");
    expect(run1.remainingAllowance).toBe("0.01");
    expect(run1.summaryLine).toBe("Bought 3 sources for $0.07.");
    expect(run1.policyHit.triggered).toBe(false);

    // 2. Attempt another $0.03 purchase -> hits the $0.08 daily cap ($0.07 + $0.03 > $0.08)
    const run2 = await runResearchAgent(
      "Fetch Seattle rent index",
      {
        agentKey,
        facilitatorUrl: facilitatorOrigin,
        datasetsBaseUrl: datasetsOrigin,
        poemsBaseUrl: poemsOrigin,
        dailyAllowanceUsd: "0.08",
        fetch: customFetch,
      },
      [`${datasetsOrigin}/datasets/rent-index?city=seattle`],
    );

    expect(run2.sourcesBought).toBe(0);
    expect(run2.policyHit.triggered).toBe(true);
    expect(run2.policyHit.code).toBe("policy_violation");
    expect(run2.policyHit.detail).toContain("daily_max");
    expect(facilitator.ledger.verifyInvariants().ok).toBe(true);
  });
});
