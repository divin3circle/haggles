/**
 * End-to-end tests for `@haggles/example-seller-poems` (`SPEC.md` section 12.2).
 */

import type { AddressInfo } from "node:net";
import { buildApp, FacilitatorService, loadConfig } from "@haggles/api";
import { createHaggles, readReceipt } from "@haggles/client";
import { describe, expect, it } from "vitest";
import { createSellerPoemsApp } from "../src/index.js";

describe("examples/seller-poems (Express, SPEC.md section 12.2)", () => {
  it("settles $0.005 /poems/random and $0.02 /poems/:id with exact sub-cent fee splits", async () => {
    const facilitatorOrigin = "https://api.haggles.example.com";
    const config = loadConfig({
      LOG_LEVEL: "silent",
      PUBLIC_API_URL: facilitatorOrigin,
    });
    const facilitator = await FacilitatorService.create(config);
    const apiApp = await buildApp({ config, facilitator });

    const wallet = facilitator.createWallet("acc_buyer_poems");
    facilitator.creditWalletTopup({
      walletId: wallet.id,
      topupId: "top_poems_1",
      grossAmountMicros: 5_000_000n,
      paypalFeeMicros: 50_000n,
    });
    const { fullKey: agentKey } = facilitator.createAgentKey({
      walletId: wallet.id,
      name: "Poems Buyer",
      perCallMaxMicros: 100_000n,
      dailyMaxMicros: 1_000_000n,
    });

    const seller = facilitator.createSeller({
      accountId: "acc_seller_poems",
      payoutEmail: "poems@example.com",
      payoutPaypalPayerId: "PAYER_POEMS_1",
    });
    const { fullKey: sellerKey } = facilitator.createSellerKey({
      sellerId: seller.id,
      name: "Poems Express Key",
    });

    const realFetch = globalThis.fetch;
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

      return realFetch(req);
    };

    // Start the Express app on an ephemeral port
    const dummyApp = createSellerPoemsApp({
      sellerId: seller.id,
      sellerKey,
      publicBaseUrl: "http://127.0.0.1:0",
      facilitatorUrl: facilitatorOrigin,
      fetch: customFetch,
    });
    const listener = await new Promise<ReturnType<typeof dummyApp.listen>>(
      (resolve) => {
        const s = dummyApp.listen(0, "127.0.0.1", () => resolve(s));
      },
    );
    const port = (listener.address() as AddressInfo).port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));

    const publicBaseUrl = `http://127.0.0.1:${port}`;
    const expressApp = createSellerPoemsApp({
      sellerId: seller.id,
      sellerKey,
      publicBaseUrl,
      facilitatorUrl: facilitatorOrigin,
      fetch: customFetch,
    });
    const server = await new Promise<ReturnType<typeof expressApp.listen>>(
      (resolve) => {
        const s = expressApp.listen(port, "127.0.0.1", () => resolve(s));
      },
    );

    try {
      const haggles = createHaggles({
        agentKey,
        facilitatorUrl: facilitatorOrigin,
        maxPricePerCall: "0.05",
        fetch: customFetch,
      });

      // 1. Sub-cent $0.005 call to GET /poems/random
      const randomRes = await haggles.fetch(`${publicBaseUrl}/poems/random`);
      expect(randomRes.status).toBe(200);
      expect(readReceipt(randomRes)?.amount).toBe("0.005");
      const randomPoem = (await randomRes.json()) as { id: string; title: string };
      expect(randomPoem.id).toBe("ozymandias");

      // 2. $0.02 call to GET /poems/micro-ledger-haiku
      const byIdRes = await haggles.fetch(
        `${publicBaseUrl}/poems/micro-ledger-haiku`,
      );
      expect(byIdRes.status).toBe(200);
      expect(readReceipt(byIdRes)?.amount).toBe("0.02");
      const haiku = (await byIdRes.json()) as { id: string; lines: string[] };
      expect(haiku.id).toBe("micro-ledger-haiku");
      expect(haiku.lines[0]).toContain("Four-oh-two");

      // Verify ledger balance & exact 5% fee split on $0.025 ($25,000 micros):
      // $0.005 (5,000 micros) -> fee = 250 micros, seller_net = 4,750 micros
      // $0.02 (20,000 micros) -> fee = 1,000 micros, seller_net = 19,000 micros
      // Total seller_net = 23,750 micros ($0.02375)
      expect(facilitator.ledger.verifyInvariants().ok).toBe(true);
      expect(facilitator.ledger.getBalance(`s_pending:${seller.id}`)).toBe(
        23_750n,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
