import { createId, formatMoney, parseMoney, type Challenge } from "@haggles/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildApp,
  FacilitatorService,
  loadConfig,
  sellerPendingAccountId,
  verifyPaymentTokenJws,
  verifyReceiptJws,
  walletAvailAccountId,
  walletHeldAccountId,
} from "../src/index.js";

function makeChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    protocol: "haggles",
    version: 1,
    scheme: "prepaid-usd",
    challenge_id: createId("chl"),
    amount: "0.02",
    currency: "USD",
    method: "GET",
    url: "https://poems.example.com/poems/42",
    seller_id: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
    description: "One poem from the collection",
    facilitator: "https://api.haggles.example.com",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("@haggles/api — M2 property-based ledger invariants (SPEC 6.2, 6.3, 8.5, 15)", () => {
  it("preserves all ledger invariants across random sequences of topup/authorize/redeem/refund/release/payout", async () => {
    type Op =
      | { kind: "topup"; grossCents: number; feeBps: number }
      | { kind: "authorize"; priceMicros: bigint }
      | { kind: "redeem"; index: number }
      | { kind: "release"; index: number }
      | { kind: "refund"; index: number }
      | { kind: "payout_success" }
      | { kind: "payout_fail" }
      | { kind: "payout_reverse" };

    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({
        kind: fc.constant("topup" as const),
        grossCents: fc.integer({ min: 500, max: 5000 }), // $5.00 .. $50.00
        feeBps: fc.integer({ min: 0, max: 400 }),
      }),
      fc.record({
        kind: fc.constant("authorize" as const),
        priceMicros: fc.bigInt({ min: 100n, max: 100_000n }),
      }),
      fc.record({
        kind: fc.constant("redeem" as const),
        index: fc.integer({ min: 0, max: 20 }),
      }),
      fc.record({
        kind: fc.constant("release" as const),
        index: fc.integer({ min: 0, max: 20 }),
      }),
      fc.record({
        kind: fc.constant("refund" as const),
        index: fc.integer({ min: 0, max: 20 }),
      }),
      fc.record({ kind: fc.constant("payout_success" as const) }),
      fc.record({ kind: fc.constant("payout_fail" as const) }),
      fc.record({ kind: fc.constant("payout_reverse" as const) }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 5, maxLength: 35 }), async (ops) => {
        const config = loadConfig({
          NODE_ENV: "test",
          LOG_LEVEL: "silent",
          PUBLIC_API_URL: "https://api.haggles.example.com",
        });
        const facilitator = await FacilitatorService.create(config);
        const wallet = facilitator.createWallet("acc_01J9Z3K4M5N6P7Q8R9S0T1U2V1");
        const seller = facilitator.createSeller({
          accountId: "acc_01J9Z3K4M5N6P7Q8R9S0T1U2V2",
          sellerId: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
          payoutPaypalPayerId: "PAYER_SELLER",
          payoutEmail: "seller@example.com",
        });
        const { fullKey: agentKey } = facilitator.createAgentKey({
          walletId: wallet.id,
          name: "prop-agent",
          perCallMaxMicros: 5_000_000n,
          dailyMaxMicros: 500_000_000n,
        });
        const { fullKey: sellerKey } = facilitator.createSellerKey({
          sellerId: seller.id,
          name: "prop-seller",
        });

        // Initial seed top-up so authorizations can proceed immediately
        facilitator.creditWalletTopup({
          walletId: wallet.id,
          topupId: createId("top"),
          grossAmountMicros: 10_000_000n,
          paypalFeeMicros: 300_000n,
        });

        const authorizedList: Array<{
          paymentId: string;
          token: string;
          amount: string;
          url: string;
        }> = [];
        const capturedIds: string[] = [];

        for (const op of ops) {
          try {
            if (op.kind === "topup") {
              const gross = BigInt(op.grossCents) * 10_000n;
              const fee = (gross * BigInt(op.feeBps)) / 10_000n;
              facilitator.creditWalletTopup({
                walletId: wallet.id,
                topupId: createId("top"),
                grossAmountMicros: gross,
                paypalFeeMicros: fee,
              });
            } else if (op.kind === "authorize") {
              const amount = formatMoney(op.priceMicros);
              const challenge = makeChallenge({
                amount,
                seller_id: seller.id,
              });
              const res = await facilitator.authorizePayment({
                rawAgentKey: agentKey,
                idempotencyKey: challenge.challenge_id,
                challengeInput: challenge,
              });
              authorizedList.push({
                paymentId: res.payment_id,
                token: res.token,
                amount: res.amount,
                url: challenge.url,
              });
            } else if (op.kind === "redeem" && authorizedList.length > 0) {
              const item = authorizedList[op.index % authorizedList.length]!;
              await facilitator.redeemPayment({
                rawSellerKey: sellerKey,
                idempotencyKey: `rdm_${item.paymentId}`,
                paymentId: item.paymentId,
                token: item.token,
                method: "GET",
                url: item.url,
                amount: item.amount,
              });
              capturedIds.push(item.paymentId);
            } else if (op.kind === "release" && authorizedList.length > 0) {
              const future = new Date(Date.now() + 200_000);
              await facilitator.releaseExpiredPayments(future);
            } else if (op.kind === "refund" && capturedIds.length > 0) {
              const payId = capturedIds[op.index % capturedIds.length]!;
              await facilitator.refundPayment({
                rawSellerKey: sellerKey,
                paymentId: payId,
                reason: "seller_initiated",
              });
            } else if (op.kind === "payout_success") {
              const pending = facilitator.ledger.getBalance(sellerPendingAccountId(seller.id));
              if (pending >= 10_000n) {
                const payoutId = createId("pot");
                const payoutAmt = (pending / 10_000n) * 10_000n;
                facilitator.postSellerPayoutStart(seller.id, payoutId, payoutAmt);
                facilitator.postSellerPayoutDone(seller.id, payoutId, payoutAmt, 1_000n);
              }
            } else if (op.kind === "payout_fail") {
              const pending = facilitator.ledger.getBalance(sellerPendingAccountId(seller.id));
              if (pending >= 10_000n) {
                const payoutId = createId("pot");
                const payoutAmt = (pending / 10_000n) * 10_000n;
                facilitator.postSellerPayoutStart(seller.id, payoutId, payoutAmt);
                facilitator.postSellerPayoutFail(seller.id, payoutId, payoutAmt);
              }
            } else if (op.kind === "payout_reverse") {
              const pending = facilitator.ledger.getBalance(sellerPendingAccountId(seller.id));
              if (pending >= 10_000n) {
                const payoutId = createId("pot");
                const payoutAmt = (pending / 10_000n) * 10_000n;
                facilitator.postSellerPayoutStart(seller.id, payoutId, payoutAmt);
                facilitator.postSellerPayoutDone(seller.id, payoutId, payoutAmt, 1_000n);
                facilitator.postSellerPayoutReversed(seller.id, payoutId, payoutAmt);
              }
            }
          } catch {
            // Expected business rejections (insufficient_funds, already_redeemed, etc.)
          }

          const report = facilitator.verifyLedgerInvariants();
          expect(report.ok, report.violations.join("; ")).toBe(true);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("@haggles/api — M2 concurrency tests (SPEC 15)", () => {
  it("allows exactly 10 out of 100 parallel POST /v1/payments when balance affords 10", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PUBLIC_API_URL: "https://api.haggles.example.com",
      TOPUP_MIN_MICROS: "100000",
    });
    const facilitator = await FacilitatorService.create(config);
    const app = await buildApp({ config, facilitator });

    const wallet = facilitator.createWallet("acc_01J9Z3K4M5N6P7Q8R9S0T1U2V1");
    const seller = facilitator.createSeller({
      accountId: "acc_01J9Z3K4M5N6P7Q8R9S0T1U2V2",
      sellerId: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
      payoutPaypalPayerId: "PAYER_1",
      payoutEmail: "seller@example.com",
    });

    // Fund wallet with exactly $0.20 (200,000 micros), which affords 10 calls at $0.02 (20,000 micros)
    facilitator.creditWalletTopup({
      walletId: wallet.id,
      topupId: createId("top"),
      grossAmountMicros: 200_000n,
      paypalFeeMicros: 0n,
    });

    const { fullKey: agentKey } = facilitator.createAgentKey({
      walletId: wallet.id,
      name: "concurrency-agent",
      perCallMaxMicros: 100_000n,
      dailyMaxMicros: 10_000_000n,
    });

    const requests = Array.from({ length: 100 }, () => {
      const challenge = makeChallenge({ amount: "0.02", seller_id: seller.id });
      return app.inject({
        method: "POST",
        url: "/v1/payments",
        headers: {
          authorization: `Bearer ${agentKey}`,
          "idempotency-key": challenge.challenge_id,
        },
        payload: { challenge },
      });
    });

    const responses = await Promise.all(requests);
    const created = responses.filter((r) => r.statusCode === 201);
    const insufficient = responses.filter((r) => r.statusCode === 409);

    expect(created.length).toBe(10);
    expect(insufficient.length).toBe(90);
    expect(facilitator.ledger.getBalance(walletAvailAccountId(wallet.id))).toBe(0n);
    expect(facilitator.ledger.getBalance(walletHeldAccountId(wallet.id))).toBe(200_000n);
    expect(facilitator.verifyLedgerInvariants().ok).toBe(true);

    await app.close();
  });

  it("allows exactly 1 out of 50 parallel redeems of the same payment token", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PUBLIC_API_URL: "https://api.haggles.example.com",
    });
    const facilitator = await FacilitatorService.create(config);
    const app = await buildApp({ config, facilitator });

    const wallet = facilitator.createWallet("acc_01J9Z3K4M5N6P7Q8R9S0T1U2V1");
    const seller = facilitator.createSeller({
      accountId: "acc_01J9Z3K4M5N6P7Q8R9S0T1U2V2",
      sellerId: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
      payoutPaypalPayerId: "PAYER_1",
      payoutEmail: "seller@example.com",
    });

    facilitator.creditWalletTopup({
      walletId: wallet.id,
      topupId: createId("top"),
      grossAmountMicros: 5_000_000n,
      paypalFeeMicros: 0n,
    });

    const { fullKey: agentKey } = facilitator.createAgentKey({
      walletId: wallet.id,
      name: "agent",
    });
    const { fullKey: sellerKey } = facilitator.createSellerKey({
      sellerId: seller.id,
      name: "seller",
    });

    const challenge = makeChallenge({ amount: "0.02", seller_id: seller.id });
    const authRes = await facilitator.authorizePayment({
      rawAgentKey: agentKey,
      idempotencyKey: challenge.challenge_id,
      challengeInput: challenge,
    });

    const redeems = Array.from({ length: 50 }, (_, idx) =>
      app.inject({
        method: "POST",
        url: `/v1/payments/${authRes.payment_id}/redeem`,
        headers: {
          authorization: `Bearer ${sellerKey}`,
          "idempotency-key": `redeem-attempt-${idx}`,
        },
        payload: {
          token: authRes.token,
          method: "GET",
          url: challenge.url,
          amount: "0.02",
          route: "/poems/:id",
        },
      }),
    );

    const results = await Promise.all(redeems);
    const okCount = results.filter((r) => r.statusCode === 200).length;
    const conflictCount = results.filter(
      (r) => r.statusCode === 409 && (r.json() as { code: string }).code === "already_redeemed",
    ).length;

    expect(okCount).toBe(1);
    expect(conflictCount).toBe(49);
    expect(facilitator.ledger.getBalance(sellerPendingAccountId(seller.id))).toBe(19_000n);
    expect(facilitator.verifyLedgerInvariants().ok).toBe(true);

    await app.close();
  });

  it("enforces daily_max policy cap under 50 concurrent requests", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PUBLIC_API_URL: "https://api.haggles.example.com",
    });
    const facilitator = await FacilitatorService.create(config);
    const app = await buildApp({ config, facilitator });

    const wallet = facilitator.createWallet("acc_01J9Z3K4M5N6P7Q8R9S0T1U2V1");
    const seller = facilitator.createSeller({
      accountId: "acc_01J9Z3K4M5N6P7Q8R9S0T1U2V2",
      sellerId: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
      payoutPaypalPayerId: "PAYER_1",
      payoutEmail: "seller@example.com",
    });

    facilitator.creditWalletTopup({
      walletId: wallet.id,
      topupId: createId("top"),
      grossAmountMicros: 10_000_000n,
      paypalFeeMicros: 0n,
    });

    // Daily max $0.10 (100,000 micros) -> exactly 5 calls at $0.02 (20,000 micros) allowed
    const { fullKey: agentKey } = facilitator.createAgentKey({
      walletId: wallet.id,
      name: "capped-agent",
      perCallMaxMicros: 100_000n,
      dailyMaxMicros: 100_000n,
    });

    const requests = Array.from({ length: 50 }, () => {
      const challenge = makeChallenge({ amount: "0.02", seller_id: seller.id });
      return app.inject({
        method: "POST",
        url: "/v1/payments",
        headers: {
          authorization: `Bearer ${agentKey}`,
          "idempotency-key": challenge.challenge_id,
        },
        payload: { challenge },
      });
    });

    const responses = await Promise.all(requests);
    const succeeded = responses.filter((r) => r.statusCode === 201);
    const policyBlocked = responses.filter(
      (r) => r.statusCode === 403 && (r.json() as { code: string }).code === "policy_violation",
    );

    expect(succeeded.length).toBe(5);
    expect(policyBlocked.length).toBe(45);
    expect(facilitator.verifyLedgerInvariants().ok).toBe(true);

    await app.close();
  });
});

describe("@haggles/api — M2 idempotency, policies, lifecycle, JWKS, and tenant isolation (SPEC 4, 5, 6, 8)", () => {
  it("proves idempotency on authorize, redeem, refund, and topup, and handles negative S_PENDING on refund", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PUBLIC_API_URL: "https://api.haggles.example.com",
    });
    const facilitator = await FacilitatorService.create(config);
    const app = await buildApp({ config, facilitator });

    const wallet = facilitator.createWallet("acc_01J9Z3K4M5N6P7Q8R9S0T1U2V1");
    const seller = facilitator.createSeller({
      accountId: "acc_01J9Z3K4M5N6P7Q8R9S0T1U2V2",
      sellerId: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
      payoutPaypalPayerId: "PAYER_1",
      payoutEmail: "seller@example.com",
    });

    // Idempotent top-up
    const top1 = facilitator.creditWalletTopup({
      walletId: wallet.id,
      topupId: "top_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
      grossAmountMicros: 5_000_000n,
      paypalFeeMicros: 200_000n,
    });
    const top2 = facilitator.creditWalletTopup({
      walletId: wallet.id,
      topupId: "top_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
      grossAmountMicros: 5_000_000n,
      paypalFeeMicros: 200_000n,
    });
    expect(top1.idempotentReplay).toBe(false);
    expect(top2.idempotentReplay).toBe(true);
    expect(top2.availableMicros).toBe(5_000_000n);

    const { fullKey: agentKey } = facilitator.createAgentKey({
      walletId: wallet.id,
      name: "buyer-key",
    });
    const { fullKey: sellerKey } = facilitator.createSellerKey({
      sellerId: seller.id,
      name: "seller-key",
    });

    // Authorize idempotency
    const challenge = makeChallenge({ amount: "0.02", seller_id: seller.id });
    const auth1 = await app.inject({
      method: "POST",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${agentKey}`, "idempotency-key": challenge.challenge_id },
      payload: { challenge },
    });
    const auth2 = await app.inject({
      method: "POST",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${agentKey}`, "idempotency-key": challenge.challenge_id },
      payload: { challenge },
    });
    expect(auth1.statusCode).toBe(201);
    expect(auth2.statusCode).toBe(201);
    expect(auth1.json()).toEqual(auth2.json());

    // Reusing same idempotency-key with different body -> 422 idempotency_conflict
    const conflictAuth = await app.inject({
      method: "POST",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${agentKey}`, "idempotency-key": challenge.challenge_id },
      payload: { challenge: { ...challenge, amount: "0.03" } },
    });
    expect(conflictAuth.statusCode).toBe(422);
    expect((conflictAuth.json() as { code: string }).code).toBe("idempotency_conflict");

    const { payment_id: paymentId, token } = auth1.json() as { payment_id: string; token: string };

    // Verify JWKS endpoint and token signature
    const jwksRes = await app.inject({ method: "GET", url: "/.well-known/jwks.json" });
    expect(jwksRes.statusCode).toBe(200);
    expect(jwksRes.headers["cache-control"]).toBe("public, max-age=300");
    const jwks = jwksRes.json() as { keys: Array<{ kid: string }> };
    const verifiedTok = await verifyPaymentTokenJws(token, jwks.keys);
    expect(verifiedTok.claims.sub).toBe(paymentId);

    // Rotate signing key and confirm token signed with just-retired key still redeems
    await facilitator.rotateSigningKey();
    const jwksAfterRotate = (await app.inject({ method: "GET", url: "/.well-known/jwks.json" })).json() as {
      keys: Array<{ kid: string }>;
    };
    expect(jwksAfterRotate.keys.length).toBe(2);

    // Redeem idempotency
    const rdm1 = await app.inject({
      method: "POST",
      url: `/v1/payments/${paymentId}/redeem`,
      headers: { authorization: `Bearer ${sellerKey}`, "idempotency-key": "rdm-key-1" },
      payload: {
        token,
        method: "GET",
        url: challenge.url,
        amount: "0.02",
        route: "/poems/:id",
      },
    });
    const rdm2 = await app.inject({
      method: "POST",
      url: `/v1/payments/${paymentId}/redeem`,
      headers: { authorization: `Bearer ${sellerKey}`, "idempotency-key": "rdm-key-1" },
      payload: {
        token,
        method: "GET",
        url: challenge.url,
        amount: "0.02",
        route: "/poems/:id",
      },
    });
    expect(rdm1.statusCode).toBe(200);
    expect(rdm2.statusCode).toBe(200);
    expect(rdm1.json()).toEqual(rdm2.json());

    const rdmBody = rdm1.json() as { seller_net: string; receipt: string };
    expect(rdmBody.seller_net).toBe("0.019"); // $0.02 minus 5% ($0.001)
    const verifiedReceipt = await verifyReceiptJws(rdmBody.receipt, jwksAfterRotate.keys);
    expect(verifiedReceipt.claims.sub).toBe(paymentId);

    // Auto-discovered endpoint exists on seller
    const endpoints = facilitator.getSellerEndpoints(seller.id);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]?.route).toBe("/poems/:id");
    expect(endpoints[0]?.lastPriceMicros).toBe(parseMoney("0.02"));

    // Simulate seller payout of 1 cent ($0.01 = 10,000 micros) before refund so refund drives S_PENDING negative
    facilitator.postSellerPayoutStart(seller.id, "pot_01J9Z3K4M5N6P7Q8R9S0T1U2V3", 10_000n);
    facilitator.postSellerPayoutDone(seller.id, "pot_01J9Z3K4M5N6P7Q8R9S0T1U2V3", 10_000n, 1_000n);
    expect(facilitator.ledger.getBalance(sellerPendingAccountId(seller.id))).toBe(9_000n);

    // Refund idempotency (drives S_PENDING from 9,000n to -10,000n, restoring W_AVAIL to 5,000,000n)
    const ref1 = await app.inject({
      method: "POST",
      url: `/v1/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${sellerKey}` },
      payload: { reason: "seller_initiated" },
    });
    const ref2 = await app.inject({
      method: "POST",
      url: `/v1/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${sellerKey}` },
      payload: { reason: "seller_initiated" },
    });
    expect(ref1.statusCode).toBe(200);
    expect(ref2.statusCode).toBe(200);
    expect(ref1.json()).toEqual(ref2.json());
    expect(facilitator.ledger.getBalance(sellerPendingAccountId(seller.id))).toBe(-10_000n);
    expect(facilitator.ledger.getBalance(walletAvailAccountId(wallet.id))).toBe(5_000_000n);
    expect(facilitator.verifyLedgerInvariants().ok).toBe(true);

    await app.close();
  });

  it("enforces all policy rules, hold expiration release, and cross-tenant isolation (SPEC 5.3, 8.4)", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PUBLIC_API_URL: "https://api.haggles.example.com",
    });
    const facilitator = await FacilitatorService.create(config);
    const app = await buildApp({ config, facilitator });

    const walletA = facilitator.createWallet("acc_01J9Z3K4M5N6P7Q8R9S0T1U2V1");
    const walletB = facilitator.createWallet("acc_01J9Z3K4M5N6P7Q8R9S0T1U2V2");
    facilitator.creditWalletTopup({
      walletId: walletA.id,
      topupId: createId("top"),
      grossAmountMicros: 10_000_000n,
      paypalFeeMicros: 0n,
    });
    facilitator.creditWalletTopup({
      walletId: walletB.id,
      topupId: createId("top"),
      grossAmountMicros: 10_000_000n,
      paypalFeeMicros: 0n,
    });

    const sellerA = facilitator.createSeller({
      accountId: "acc_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
      sellerId: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
      payoutPaypalPayerId: "PAYER_A",
      payoutEmail: "a@example.com",
    });
    const sellerB = facilitator.createSeller({
      accountId: "acc_01J9Z3K4M5N6P7Q8R9S0T1U2V4",
      sellerId: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V4",
      payoutPaypalPayerId: "PAYER_B",
      payoutEmail: "b@example.com",
    });

    const { record: keyARecord, fullKey: agentKeyA } = facilitator.createAgentKey({
      walletId: walletA.id,
      name: "strict-agent",
      perCallMaxMicros: 50_000n, // $0.05
      dailyMaxMicros: 100_000n, // $0.10
      monthlyMaxMicros: 80_000n, // $0.08
      allowedSellers: [sellerA.id],
      allowedHosts: ["poems.example.com"],
    });
    const { fullKey: agentKeyB } = facilitator.createAgentKey({
      walletId: walletB.id,
      name: "other-agent",
    });

    const { fullKey: sellerKeyA } = facilitator.createSellerKey({
      sellerId: sellerA.id,
      name: "seller-a-1",
    });
    facilitator.createSellerKey({ sellerId: sellerA.id, name: "seller-a-2" });
    // 3rd active seller key is forbidden (max 2 active per seller, SPEC 6.1)
    expect(() => facilitator.createSellerKey({ sellerId: sellerA.id, name: "seller-a-3" })).toThrow(
      /Maximum of 2 active seller keys/,
    );

    const { fullKey: sellerKeyB } = facilitator.createSellerKey({
      sellerId: sellerB.id,
      name: "seller-b-1",
    });

    // 1. Disallowed seller -> 403 policy_violation (detail mentions allowed_sellers)
    const badSellerChl = makeChallenge({ seller_id: sellerB.id, amount: "0.02" });
    const badSellerRes = await app.inject({
      method: "POST",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${agentKeyA}`, "idempotency-key": badSellerChl.challenge_id },
      payload: { challenge: badSellerChl },
    });
    expect(badSellerRes.statusCode).toBe(403);
    expect((badSellerRes.json() as { detail: string }).detail).toContain("allowed_sellers");

    // 2. Disallowed host -> 403 policy_violation (detail mentions allowed_hosts)
    const badHostChl = makeChallenge({
      seller_id: sellerA.id,
      url: "https://other.example.com/poems/42",
      amount: "0.02",
    });
    const badHostRes = await app.inject({
      method: "POST",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${agentKeyA}`, "idempotency-key": badHostChl.challenge_id },
      payload: { challenge: badHostChl },
    });
    expect(badHostRes.statusCode).toBe(403);
    expect((badHostRes.json() as { detail: string }).detail).toContain("allowed_hosts");

    // 3. Exceed per_call_max ($0.06 > $0.05) -> 403 policy_violation (detail mentions per_call_max)
    const bigCallChl = makeChallenge({ seller_id: sellerA.id, amount: "0.06" });
    const bigCallRes = await app.inject({
      method: "POST",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${agentKeyA}`, "idempotency-key": bigCallChl.challenge_id },
      payload: { challenge: bigCallChl },
    });
    expect(bigCallRes.statusCode).toBe(403);
    expect((bigCallRes.json() as { detail: string }).detail).toContain("per_call_max");

    // 4. Two $0.04 authorizations succeed ($0.08 total == monthly_max); third $0.01 fails on monthly_max
    const chl1 = makeChallenge({ seller_id: sellerA.id, amount: "0.04" });
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${agentKeyA}`, "idempotency-key": chl1.challenge_id },
      payload: { challenge: chl1 },
    });
    expect(res1.statusCode).toBe(201);
    const pay1Id = (res1.json() as { payment_id: string }).payment_id;

    const chl2 = makeChallenge({ seller_id: sellerA.id, amount: "0.04" });
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${agentKeyA}`, "idempotency-key": chl2.challenge_id },
      payload: { challenge: chl2 },
    });
    expect(res2.statusCode).toBe(201);

    const chl3 = makeChallenge({ seller_id: sellerA.id, amount: "0.01" });
    const res3 = await app.inject({
      method: "POST",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${agentKeyA}`, "idempotency-key": chl3.challenge_id },
      payload: { challenge: chl3 },
    });
    expect(res3.statusCode).toBe(403);
    expect((res3.json() as { detail: string }).detail).toContain("monthly_max");

    // 5. Check GET /v1/wallet allowance
    const walRes = await app.inject({
      method: "GET",
      url: "/v1/wallet",
      headers: { authorization: `Bearer ${agentKeyA}` },
    });
    expect(walRes.statusCode).toBe(200);
    expect(walRes.json()).toEqual({
      available: "9.92",
      held: "0.08",
      currency: "USD",
      allowance: {
        per_call_max: "0.05",
        daily_remaining: "0.02",
        monthly_remaining: "0.00",
      },
    });

    // 6. Cross-tenant isolation (SPEC 8.4):
    // Buyer B cannot read Buyer A's payment -> 404
    const crossBuyerGet = await app.inject({
      method: "GET",
      url: `/v1/payments/${pay1Id}`,
      headers: { authorization: `Bearer ${agentKeyB}` },
    });
    expect(crossBuyerGet.statusCode).toBe(404);

    // Seller B cannot read Seller A's payment -> 404
    const crossSellerGet = await app.inject({
      method: "GET",
      url: `/v1/payments/${pay1Id}`,
      headers: { authorization: `Bearer ${sellerKeyB}` },
    });
    expect(crossSellerGet.statusCode).toBe(404);

    // Seller A reading own payment sees pseudonymous agent_ref (10 hex chars) and never walletId/agentKeyId
    const sellerGet = await app.inject({
      method: "GET",
      url: `/v1/payments/${pay1Id}`,
      headers: { authorization: `Bearer ${sellerKeyA}` },
    });
    expect(sellerGet.statusCode).toBe(200);
    const sellerPaymentView = sellerGet.json() as Record<string, unknown>;
    expect(sellerPaymentView.agent_ref).toMatch(/^[0-9a-f]{10}$/);
    expect(sellerPaymentView.wallet_id).toBeUndefined();
    expect(sellerPaymentView.agent_key_id).toBeUndefined();

    // 7. Releasing expired holds restores available balance and spend allowance
    const releasedCount = await facilitator.releaseExpiredPayments(
      new Date(Date.now() + 300_000),
    );
    expect(releasedCount).toBe(2);

    const walAfterRelease = await app.inject({
      method: "GET",
      url: "/v1/wallet",
      headers: { authorization: `Bearer ${agentKeyA}` },
    });
    expect(walAfterRelease.json()).toEqual({
      available: "10.00",
      held: "0.00",
      currency: "USD",
      allowance: {
        per_call_max: "0.05",
        daily_remaining: "0.10",
        monthly_remaining: "0.08",
      },
    });

    // 8. Revoking key A rejects further calls with 401 key_revoked
    facilitator.revokeAgentKey(keyARecord.id);
    const revokedRes = await app.inject({
      method: "GET",
      url: "/v1/wallet",
      headers: { authorization: `Bearer ${agentKeyA}` },
    });
    expect(revokedRes.statusCode).toBe(401);
    expect((revokedRes.json() as { code: string }).code).toBe("key_revoked");

    expect(facilitator.verifyLedgerInvariants().ok).toBe(true);
    await app.close();
  });
});
