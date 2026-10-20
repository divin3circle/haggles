/**
 * End-to-end tests for `@haggles/example-seller-datasets` (`SPEC.md` section 12.1).
 */

import { buildApp, FacilitatorService, loadConfig } from "@haggles/api";
import { createHaggles, readReceipt } from "@haggles/client";
import { describe, expect, it } from "vitest";
import { createSellerDatasetsApp } from "../src/index.js";

describe("examples/seller-datasets (Hono, SPEC.md section 12.1)", () => {
  it("serves /datasets/summary for free and settles $0.03 rent-index + $0.01 transit-fares via HTTP 402", async () => {
    const facilitatorOrigin = "https://api.haggles.example.com";
    const sellerOrigin = "https://datasets.example.com";
    const config = loadConfig({
      LOG_LEVEL: "silent",
      PUBLIC_API_URL: facilitatorOrigin,
    });
    const facilitator = await FacilitatorService.create(config);
    const apiApp = await buildApp({ config, facilitator });

    const wallet = facilitator.createWallet("acc_buyer_datasets");
    facilitator.creditWalletTopup({
      walletId: wallet.id,
      topupId: "top_datasets_1",
      grossAmountMicros: 5_000_000n,
      paypalFeeMicros: 50_000n,
    });
    const { fullKey: agentKey } = facilitator.createAgentKey({
      walletId: wallet.id,
      name: "Datasets Buyer",
      perCallMaxMicros: 100_000n,
      dailyMaxMicros: 1_000_000n,
    });

    const seller = facilitator.createSeller({
      accountId: "acc_seller_datasets",
      payoutEmail: "datasets@example.com",
      payoutPaypalPayerId: "PAYER_DATASETS_1",
    });
    const { fullKey: sellerKey } = facilitator.createSellerKey({
      sellerId: seller.id,
      name: "Datasets Hono Key",
    });

    let sellerApp!: ReturnType<typeof createSellerDatasetsApp>;

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

      if (url.origin === sellerOrigin) {
        return sellerApp.fetch(req);
      }

      throw new Error(`Unexpected origin: ${url.origin}`);
    };

    sellerApp = createSellerDatasetsApp({
      sellerId: seller.id,
      sellerKey,
      publicBaseUrl: sellerOrigin,
      facilitatorUrl: facilitatorOrigin,
      fetch: customFetch,
    });

    const haggles = createHaggles({
      agentKey,
      facilitatorUrl: facilitatorOrigin,
      maxPricePerCall: "0.10",
      fetch: customFetch,
    });

    // 1. Free endpoint (/datasets/summary) works without payment
    const freeRes = await haggles.fetch(`${sellerOrigin}/datasets/summary`);
    expect(freeRes.status).toBe(200);
    expect(readReceipt(freeRes)).toBeNull();
    const summaryJson = (await freeRes.json()) as {
      available_cities: Array<{ slug: string }>;
    };
    expect(summaryJson.available_cities.map((c) => c.slug)).toEqual([
      "austin",
      "chicago",
      "seattle",
    ]);

    // 2. Paid endpoint (/datasets/rent-index?city=austin) settles $0.03
    const rentRes = await haggles.fetch(
      `${sellerOrigin}/datasets/rent-index?city=austin`,
    );
    expect(rentRes.status).toBe(200);
    const rentReceipt = readReceipt(rentRes);
    expect(rentReceipt?.amount).toBe("0.03");
    const rentJson = (await rentRes.json()) as {
      slug: string;
      rent_index: { median_1br_usd: number };
    };
    expect(rentJson.slug).toBe("austin");
    expect(rentJson.rent_index.median_1br_usd).toBe(1620);

    // 3. Paid endpoint (/datasets/transit-fares?city=chicago) settles $0.01
    const transitRes = await haggles.fetch(
      `${sellerOrigin}/datasets/transit-fares?city=chicago`,
    );
    expect(transitRes.status).toBe(200);
    const transitReceipt = readReceipt(transitRes);
    expect(transitReceipt?.amount).toBe("0.01");
    const transitJson = (await transitRes.json()) as {
      slug: string;
      transit_fares: { single_ride_usd: string };
    };
    expect(transitJson.slug).toBe("chicago");
    expect(transitJson.transit_fares.single_ride_usd).toBe("2.50");

    // Verify ledger invariant holds and buyer spent $0.04 total
    expect(facilitator.ledger.verifyInvariants().ok).toBe(true);
    expect(facilitator.ledger.getBalance(`w_avail:${wallet.id}`)).toBe(
      4_960_000n,
    );
  });
});
