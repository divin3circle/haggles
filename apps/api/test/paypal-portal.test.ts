/**
 * Milestone M3 tests: PayPal integration, Portal API (`/portal/v1/*`), Webhooks (`POST /webhooks/paypal`),
 * CSRF/Session security, and Cross-Tenant IDOR isolation.
 *
 * Covers SPEC.md sections 5.2, 7.1, 7.2, 8.3, 8.4, 8.5, 15.1, and 15.2.
 */

import { describe, expect, it } from "vitest";
import {
  buildApp,
  FacilitatorService,
  loadConfig,
  MockPayPalGateway,
  parseCookies,
  SandboxPayPalGateway,
} from "../src/index.js";

const VALID_WEBHOOK_HEADERS = {
  "content-type": "application/json",
  "paypal-transmission-id": "tx_01J9Z3MOCKWEBHOOK",
  "paypal-transmission-sig": "mock-valid-signature",
};

/**
 * Helper to log in a mock PayPal user through `/portal/v1/auth/paypal/start` and `/callback`
 * and return the session cookie header and CSRF token.
 */
async function loginPortalUser(
  app: Awaited<ReturnType<typeof buildApp>>,
  paypalGateway: MockPayPalGateway,
  identity: {
    code: string;
    payerId: string;
    userId: string;
    email: string;
    displayName: string;
    verifiedAccount: boolean;
  },
): Promise<{
  cookieHeader: string;
  csrfToken: string;
  accountId: string;
}> {
  paypalGateway.registerMockAuthCode(identity.code, {
    paypalPayerId: identity.payerId,
    paypalUserId: identity.userId,
    email: identity.email,
    displayName: identity.displayName,
    verifiedAccount: identity.verifiedAccount,
  });

  const startRes = await app.inject({
    method: "GET",
    url: "/portal/v1/auth/paypal/start",
    headers: { accept: "application/json" },
  });
  expect(startRes.statusCode).toBe(200);
  const startBody = startRes.json<{ authorize_url: string; state: string }>();
  const startSetCookie = startRes.headers["set-cookie"];
  const stateCookieHeader = Array.isArray(startSetCookie)
    ? startSetCookie.map((c) => c.split(";")[0]).join("; ")
    : (startSetCookie?.split(";")[0] ?? "");

  const cbRes = await app.inject({
    method: "GET",
    url: `/portal/v1/auth/paypal/callback?code=${encodeURIComponent(identity.code)}&state=${encodeURIComponent(startBody.state)}`,
    headers: {
      accept: "application/json",
      cookie: stateCookieHeader,
    },
  });
  expect(cbRes.statusCode).toBe(200);
  const cbBody = cbRes.json<{
    account: { id: string };
    is_new_account: boolean;
    redirect_to: string;
  }>();

  const rawCookies = cbRes.headers["set-cookie"];
  const cookieList = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
  const pairs = cookieList.map((c) => c.split(";")[0] ?? "").filter(Boolean);
  const cookieHeader = pairs.join("; ");
  const parsed = parseCookies(cookieHeader);

  return {
    cookieHeader,
    csrfToken: parsed.hg_csrf ?? "",
    accountId: cbBody.account.id,
  };
}

describe("M3: PayPal OIDC Login, Sessions, CSRF & Role Management (SPEC.md 5.2, 8.3, 11.6)", () => {
  it("completes Log in with PayPal, enforces CSRF + Origin on state-changing routes, and guards role disabling when balance > 0", async () => {
    const config = loadConfig({ LOG_LEVEL: "silent", PAYPAL_MODE: "mock" });
    const paypal = new MockPayPalGateway();
    const facilitator = await FacilitatorService.create(config, paypal);
    const app = await buildApp({ config, facilitator });

    const { cookieHeader, csrfToken } = await loginPortalUser(app, paypal, {
      code: "code_alice",
      payerId: "PAYER_ALICE_01",
      userId: "https://www.paypal.com/webapps/auth/identity/user/ALICE01",
      email: "alice@example.com",
      displayName: "Alice Dev",
      verifiedAccount: true,
    });

    // GET /portal/v1/me succeeds without CSRF header
    const meRes = await app.inject({
      method: "GET",
      url: "/portal/v1/me",
      headers: { cookie: cookieHeader },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json()).toMatchObject({
      email: "alice@example.com",
      paypal_payer_id: "PAYER_ALICE_01",
      is_buyer: false,
      is_seller: false,
    });

    // PATCH /portal/v1/me WITHOUT CSRF header -> 403 forbidden
    const noCsrfRes = await app.inject({
      method: "PATCH",
      url: "/portal/v1/me",
      headers: { cookie: cookieHeader },
      payload: { is_buyer: true },
    });
    expect(noCsrfRes.statusCode).toBe(403);

    // PATCH /portal/v1/me WITH wrong Origin -> 403 forbidden
    const badOriginRes = await app.inject({
      method: "PATCH",
      url: "/portal/v1/me",
      headers: {
        cookie: cookieHeader,
        "x-haggles-csrf": csrfToken,
        origin: "https://evil.example.com",
      },
      payload: { is_buyer: true },
    });
    expect(badOriginRes.statusCode).toBe(403);

    // Enable both Buyer and Seller roles with valid CSRF + Origin
    const enableRes = await app.inject({
      method: "PATCH",
      url: "/portal/v1/me",
      headers: {
        cookie: cookieHeader,
        "x-haggles-csrf": csrfToken,
        origin: config.PUBLIC_PORTAL_URL,
      },
      payload: { is_buyer: true, is_seller: true, display_name: "Alice Builder" },
    });
    expect(enableRes.statusCode).toBe(200);
    const enabledBody = enableRes.json<{
      is_buyer: boolean;
      is_seller: boolean;
      wallet_id: string;
      seller_id: string;
      display_name: string;
    }>();
    expect(enabledBody.is_buyer).toBe(true);
    expect(enabledBody.is_seller).toBe(true);
    expect(enabledBody.wallet_id).toMatch(/^wal_/);
    expect(enabledBody.seller_id).toMatch(/^slr_/);

    // Fund wallet with $10.00 and verify Buyer role CANNOT be disabled while balance > 0 (SPEC 11.6)
    facilitator.creditWalletTopup({
      walletId: enabledBody.wallet_id,
      topupId: "top_alice_1",
      grossAmountMicros: 10_000_000n,
      paypalFeeMicros: 500_000n,
    });

    const disableBuyerRes = await app.inject({
      method: "PATCH",
      url: "/portal/v1/me",
      headers: {
        cookie: cookieHeader,
        "x-haggles-csrf": csrfToken,
      },
      payload: { is_buyer: false },
    });
    expect(disableBuyerRes.statusCode).toBe(403);

    // Seller role has 0 balance so it CAN be disabled
    const disableSellerRes = await app.inject({
      method: "PATCH",
      url: "/portal/v1/me",
      headers: {
        cookie: cookieHeader,
        "x-haggles-csrf": csrfToken,
      },
      payload: { is_seller: false },
    });
    expect(disableSellerRes.statusCode).toBe(200);
    expect(disableSellerRes.json<{ is_seller: boolean }>().is_seller).toBe(false);

    // Logout invalidates the session
    const logoutRes = await app.inject({
      method: "POST",
      url: "/portal/v1/auth/logout",
      headers: {
        cookie: cookieHeader,
        "x-haggles-csrf": csrfToken,
      },
    });
    expect(logoutRes.statusCode).toBe(200);

    const afterLogoutRes = await app.inject({
      method: "GET",
      url: "/portal/v1/me",
      headers: { cookie: cookieHeader },
    });
    expect(afterLogoutRes.statusCode).toBe(401);

    await app.close();
  });
});

describe("M3: Wallet Top-up Flows & PayPal Webhooks (SPEC.md 7.1, 8.5)", () => {
  it("handles COMPLETED capture, PENDING -> webhook completion, DECLINED capture, idempotency, and REVERSED wallet freeze", async () => {
    const config = loadConfig({ LOG_LEVEL: "silent", PAYPAL_MODE: "mock" });
    const paypal = new MockPayPalGateway();
    const facilitator = await FacilitatorService.create(config, paypal);
    const app = await buildApp({ config, facilitator });

    const { cookieHeader, csrfToken } = await loginPortalUser(app, paypal, {
      code: "code_buyer1",
      payerId: "PAYER_BUYER_01",
      userId: "https://www.paypal.com/webapps/auth/identity/user/BUYER01",
      email: "buyer1@example.com",
      displayName: "Buyer One",
      verifiedAccount: true,
    });

    await app.inject({
      method: "PATCH",
      url: "/portal/v1/me",
      headers: { cookie: cookieHeader, "x-haggles-csrf": csrfToken },
      payload: { is_buyer: true },
    });

    // 1. COMPLETED capture flow ($25.00)
    const create1 = await app.inject({
      method: "POST",
      url: "/portal/v1/buyer/topups",
      headers: { cookie: cookieHeader, "x-haggles-csrf": csrfToken },
      payload: { amount: "25.00" },
    });
    expect(create1.statusCode).toBe(201);
    const topup1 = create1.json<{ id: string; order_id: string; status: string }>();
    expect(topup1.status).toBe("created");

    const cap1 = await app.inject({
      method: "POST",
      url: `/portal/v1/buyer/topups/${topup1.id}/capture`,
      headers: { cookie: cookieHeader, "x-haggles-csrf": csrfToken },
    });
    expect(cap1.statusCode).toBe(200);
    const cap1Body = cap1.json<{ id: string; capture_id: string; status: string; amount: string }>();
    expect(cap1Body.status).toBe("credited");
    expect(cap1Body.amount).toBe("25.00");

    // Repeat capture call is idempotent and does not double-credit
    const cap1Repeat = await app.inject({
      method: "POST",
      url: `/portal/v1/buyer/topups/${topup1.id}/capture`,
      headers: { cookie: cookieHeader, "x-haggles-csrf": csrfToken },
    });
    expect(cap1Repeat.statusCode).toBe(200);

    // Webhook arriving after synchronous capture is also idempotent (no double-credit)
    const wh1 = await app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: VALID_WEBHOOK_HEADERS,
      payload: JSON.stringify({
        id: "WH_EVT_TOPUP_1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: cap1Body.capture_id,
          custom_id: topup1.id,
          supplementary_data: { related_ids: { order_id: topup1.order_id } },
        },
      }),
    });
    expect(wh1.statusCode).toBe(200);
    expect(wh1.json()).toMatchObject({ verified: true, duplicate: false });

    // Replaying the exact same webhook event ID returns duplicate: true
    const wh1Dup = await app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: VALID_WEBHOOK_HEADERS,
      payload: JSON.stringify({
        id: "WH_EVT_TOPUP_1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { id: cap1Body.capture_id },
      }),
    });
    expect(wh1Dup.statusCode).toBe(200);
    expect(wh1Dup.json()).toMatchObject({ verified: true, duplicate: true });

    // 2. PENDING capture -> only credited when PAYMENT.CAPTURE.COMPLETED webhook arrives (SPEC 7.1 step 4)
    paypal.setNextCaptureStatus("PENDING");
    const create2 = await app.inject({
      method: "POST",
      url: "/portal/v1/buyer/topups",
      headers: { cookie: cookieHeader, "x-haggles-csrf": csrfToken },
      payload: { amount: "10.00" },
    });
    const topup2 = create2.json<{ id: string; order_id: string }>();

    const cap2 = await app.inject({
      method: "POST",
      url: `/portal/v1/buyer/topups/${topup2.id}/capture`,
      headers: { cookie: cookieHeader, "x-haggles-csrf": csrfToken },
    });
    expect(cap2.statusCode).toBe(200);
    expect(cap2.json<{ status: string }>().status).toBe("pending");

    // Balance is still $25.00 (not $35.00 yet)
    const sumBeforeWh = await app.inject({
      method: "GET",
      url: "/portal/v1/buyer/summary",
      headers: { cookie: cookieHeader },
    });
    expect(sumBeforeWh.json<{ available: string }>().available).toBe("25.00");

    // Now PayPal settles the pending capture and sends PAYMENT.CAPTURE.COMPLETED
    paypal.setOrderCaptureStatus(topup2.order_id, "COMPLETED");

    // Even if a spoofed webhook body claims amount is 999.00, facilitator re-fetches from PayPal ($10.00)
    const wh2 = await app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: VALID_WEBHOOK_HEADERS,
      payload: `{ "id": "WH_EVT_TOPUP_2", "event_type": "PAYMENT.CAPTURE.COMPLETED", "resource": { "custom_id": "${topup2.id}", "amount": { "value": "999.00" } } }`,
    });
    expect(wh2.statusCode).toBe(200);

    const sumAfterWh = await app.inject({
      method: "GET",
      url: "/portal/v1/buyer/summary",
      headers: { cookie: cookieHeader },
    });
    expect(sumAfterWh.json<{ available: string }>().available).toBe("35.00");

    // 3. DECLINED capture marks top-up failed and credits 0
    paypal.setNextCaptureStatus("DECLINED");
    const create3 = await app.inject({
      method: "POST",
      url: "/portal/v1/buyer/topups",
      headers: { cookie: cookieHeader, "x-haggles-csrf": csrfToken },
      payload: { amount: "15.00" },
    });
    const topup3 = create3.json<{ id: string; order_id: string }>();

    const cap3 = await app.inject({
      method: "POST",
      url: `/portal/v1/buyer/topups/${topup3.id}/capture`,
      headers: { cookie: cookieHeader, "x-haggles-csrf": csrfToken },
    });
    expect(cap3.statusCode).toBe(200);
    expect(cap3.json<{ status: string }>().status).toBe("failed");
    paypal.setNextCaptureStatus("COMPLETED");

    // 4. Invalid webhook signature returns 401
    const badSigRes = await app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: {
        "content-type": "application/json",
        "paypal-transmission-id": "tx_bad",
        "paypal-transmission-sig": "forged-signature",
      },
      payload: JSON.stringify({ id: "WH_BAD", event_type: "PAYMENT.CAPTURE.COMPLETED" }),
    });
    expect(badSigRes.statusCode).toBe(401);

    // 5. PAYMENT.CAPTURE.REVERSED marks topup reversed and freezes wallet (SPEC 7.1 step 7)
    const whRev = await app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: VALID_WEBHOOK_HEADERS,
      payload: JSON.stringify({
        id: "WH_EVT_REV_1",
        event_type: "PAYMENT.CAPTURE.REVERSED",
        resource: { custom_id: topup2.id },
      }),
    });
    expect(whRev.statusCode).toBe(200);

    const sumFrozen = await app.inject({
      method: "GET",
      url: "/portal/v1/buyer/summary",
      headers: { cookie: cookieHeader },
    });
    expect(sumFrozen.json<{ status: string }>().status).toBe("frozen");

    // Verify all ledger invariants hold
    const report = facilitator.verifyLedgerInvariants();
    expect(report.ok).toBe(true);

    await app.close();
  });
});

describe("M3: Seller Payouts, Webhooks & Crash Recovery (SPEC.md 7.2)", () => {
  it("handles PayPal payouts, sub-cent floor rounding, rate limit, item webhooks, simulated mode, and duplicate sender_batch_id recovery", async () => {
    const config = loadConfig({ LOG_LEVEL: "silent", PAYPAL_MODE: "mock" });
    const paypal = new MockPayPalGateway();
    const facilitator = await FacilitatorService.create(config, paypal);
    const app = await buildApp({ config, facilitator });

    // Log in seller and buyer
    const sellerSession = await loginPortalUser(app, paypal, {
      code: "code_seller1",
      payerId: "PAYER_SELLER_01",
      userId: "https://www.paypal.com/webapps/auth/identity/user/SELLER01",
      email: "seller1@example.com",
      displayName: "Seller One",
      verifiedAccount: true,
    });
    const enableSeller = await app.inject({
      method: "PATCH",
      url: "/portal/v1/me",
      headers: {
        cookie: sellerSession.cookieHeader,
        "x-haggles-csrf": sellerSession.csrfToken,
      },
      payload: { is_seller: true, is_buyer: true },
    });
    const { seller_id: sellerId, wallet_id: walletId } = enableSeller.json<{
      seller_id: string;
      wallet_id: string;
    }>();

    // Fund buyer wallet and run a captured payment of $2.005 (net after 5% fee = $1.90475)
    facilitator.creditWalletTopup({
      walletId,
      topupId: "top_for_seller_test",
      grossAmountMicros: 10_000_000n,
      paypalFeeMicros: 300_000n,
    });
    const { fullKey: agentKey } = facilitator.createAgentKey({
      walletId,
      name: "Agent 1",
      perCallMaxMicros: 5_000_000n,
      dailyMaxMicros: 10_000_000n,
    });
    const { fullKey: sellerKey } = facilitator.createSellerKey({
      sellerId,
      name: "Prod Server",
    });

    const authPayment = await facilitator.authorizePayment({
      rawAgentKey: agentKey,
      idempotencyKey: "chl_01J9Z3PAYOUTTEST0000000001",
      challengeInput: {
        protocol: "haggles",
        version: 1,
        scheme: "prepaid-usd",
        challenge_id: "chl_01J9Z3PAYOUTTEST0000000001",
        amount: "2.005",
        currency: "USD",
        method: "GET",
        url: "https://datasets.example.com/datasets/rent-index?city=sf",
        seller_id: sellerId,
        facilitator: config.PUBLIC_API_URL,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    await facilitator.redeemPayment({
      rawSellerKey: sellerKey,
      idempotencyKey: "red_01",
      paymentId: authPayment.payment_id,
      token: authPayment.token,
      method: "GET",
      url: "https://datasets.example.com/datasets/rent-index?city=sf",
      amount: "2.005",
      route: "/datasets/rent-index",
    });

    // Seller pending balance is 2.005 - 5% (0.10025) = 1.904750 USD
    const summaryBefore = await app.inject({
      method: "GET",
      url: "/portal/v1/seller/summary",
      headers: { cookie: sellerSession.cookieHeader },
    });
    expect(summaryBefore.json<{ pending: string }>().pending).toBe("1.90475");

    // Request payout via portal: floors to whole cents ($1.90), leaving $0.00475 in S_PENDING
    const payoutRes = await app.inject({
      method: "POST",
      url: "/portal/v1/seller/payouts",
      headers: {
        cookie: sellerSession.cookieHeader,
        "x-haggles-csrf": sellerSession.csrfToken,
      },
    });
    expect(payoutRes.statusCode).toBe(201);
    const payout1 = payoutRes.json<{
      id: string;
      amount: string;
      paypal_batch_id: string;
      status: string;
    }>();
    expect(payout1.amount).toBe("1.90");
    expect(payout1.status).toBe("processing");

    // Requesting a second on-demand payout within 1 hour is rejected with 429 rate_limited (SPEC 7.2 step 2)
    const rateLimitedRes = await app.inject({
      method: "POST",
      url: "/portal/v1/seller/payouts",
      headers: {
        cookie: sellerSession.cookieHeader,
        "x-haggles-csrf": sellerSession.csrfToken,
      },
    });
    expect(rateLimitedRes.statusCode).toBe(429);

    // Sub-cent remainder ($0.00475) stayed in S_PENDING, while $1.90 is in S_PAYOUT (processing)
    const summaryMid = await app.inject({
      method: "GET",
      url: "/portal/v1/seller/summary",
      headers: { cookie: sellerSession.cookieHeader },
    });
    expect(summaryMid.json<{ pending: string; processing: string }>().pending).toBe("0.00475");
    expect(summaryMid.json<{ pending: string; processing: string }>().processing).toBe("1.90");

    // Deliver PAYMENT.PAYOUTS-ITEM.SUCCEEDED webhook
    const whPayoutSuccess = await app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: VALID_WEBHOOK_HEADERS,
      payload: JSON.stringify({
        id: "WH_PAYOUT_1",
        event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        resource: {
          payout_batch_id: payout1.paypal_batch_id,
          payout_item: { sender_item_id: payout1.id },
        },
      }),
    });
    expect(whPayoutSuccess.statusCode).toBe(200);

    const summaryAfter = await app.inject({
      method: "GET",
      url: "/portal/v1/seller/summary",
      headers: { cookie: sellerSession.cookieHeader },
    });
    expect(summaryAfter.json<{ processing: string; paid_out: string }>().processing).toBe("0.00");
    expect(summaryAfter.json<{ processing: string; paid_out: string }>().paid_out).toBe("1.90");

    // Deliver PAYMENT.PAYOUTS-ITEM.RETURNED after success -> posts PAYOUT_REVERSED and restores $1.90 to S_PENDING
    const whPayoutReturned = await app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: VALID_WEBHOOK_HEADERS,
      payload: JSON.stringify({
        id: "WH_PAYOUT_1_RET",
        event_type: "PAYMENT.PAYOUTS-ITEM.RETURNED",
        resource: {
          payout_batch_id: payout1.paypal_batch_id,
          payout_item: { sender_item_id: payout1.id },
        },
      }),
    });
    expect(whPayoutReturned.statusCode).toBe(200);

    const summaryReversed = await app.inject({
      method: "GET",
      url: "/portal/v1/seller/summary",
      headers: { cookie: sellerSession.cookieHeader },
    });
    expect(summaryReversed.json<{ pending: string }>().pending).toBe("1.90475");

    // Test simulated payout mode (SPEC 7.2 step 6)
    const sellerRecord = facilitator.getSellerForAccount(sellerSession.accountId);
    sellerRecord.payoutMode = "simulated";
    const simPayout = await facilitator.requestSellerPayout({
      sellerId,
      requestedBy: "schedule",
    });
    expect(simPayout.mode).toBe("simulated");
    expect(simPayout.status).toBe("succeeded");
    expect(simPayout.amountMicros).toBe(1_900_000n);

    expect(facilitator.verifyLedgerInvariants().ok).toBe(true);
    await app.close();
  });

  it("recovers from duplicate sender_batch_id by following PayPal's HATEOAS batch link (SPEC.md 7.2 step 4)", async () => {
    const config = loadConfig({
      LOG_LEVEL: "silent",
      PAYPAL_MODE: "sandbox",
      PAYPAL_CLIENT_ID: "sb_client",
      PAYPAL_CLIENT_SECRET: "sb_secret",
      PAYPAL_WEBHOOK_ID: "sb_wh_id",
    });

    const mockFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok_123", expires_in: 32400 }), {
          status: 200,
        });
      }
      if (url.endsWith("/v1/payments/payouts")) {
        // Simulate crash retry where PayPal rejects duplicate sender_batch_id and provides link to original batch
        return new Response(
          JSON.stringify({
            name: "USER_BUSINESS_ERROR",
            message: "Duplicate batch",
            links: [
              {
                rel: "self",
                href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH_RECOVERED_999",
              },
            ],
          }),
          { status: 400 },
        );
      }
      if (url.endsWith("/v1/payments/payouts/BATCH_RECOVERED_999")) {
        return new Response(
          JSON.stringify({
            batch_header: {
              payout_batch_id: "BATCH_RECOVERED_999",
              batch_status: "PROCESSING",
            },
            items: [],
          }),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const gateway = new SandboxPayPalGateway(config, mockFetch);
    const res = await gateway.createPayoutBatch({
      batchRef: "hgb_01J9Z3DUPTEST",
      items: [
        {
          payoutId: "pot_01",
          receiverPayerId: "PAYER_123",
          amountMicros: 5_000_000n,
        },
      ],
    });
    expect(res.paypalBatchId).toBe("BATCH_RECOVERED_999");
  });
});

describe("M3: Cross-Tenant IDOR Security Suite (SPEC.md 8.4)", () => {
  it("returns 404 (never 403 or 200) when Account B accesses any {id} resource belonging to Account A", async () => {
    const config = loadConfig({ LOG_LEVEL: "silent", PAYPAL_MODE: "mock" });
    const paypal = new MockPayPalGateway();
    const facilitator = await FacilitatorService.create(config, paypal);
    const app = await buildApp({ config, facilitator });

    // Provision Tenant A (Buyer + Seller)
    const tenantA = await loginPortalUser(app, paypal, {
      code: "code_tenant_a",
      payerId: "PAYER_TENANT_A",
      userId: "https://www.paypal.com/webapps/auth/identity/user/TENANTA",
      email: "tenant-a@example.com",
      displayName: "Tenant A",
      verifiedAccount: true,
    });
    const enableA = await app.inject({
      method: "PATCH",
      url: "/portal/v1/me",
      headers: { cookie: tenantA.cookieHeader, "x-haggles-csrf": tenantA.csrfToken },
      payload: { is_buyer: true, is_seller: true },
    });
    const { wallet_id: walletA, seller_id: sellerA } = enableA.json<{
      wallet_id: string;
      seller_id: string;
    }>();

    // Provision Tenant B (Buyer + Seller)
    const tenantB = await loginPortalUser(app, paypal, {
      code: "code_tenant_b",
      payerId: "PAYER_TENANT_B",
      userId: "https://www.paypal.com/webapps/auth/identity/user/TENANTB",
      email: "tenant-b@example.com",
      displayName: "Tenant B",
      verifiedAccount: true,
    });
    await app.inject({
      method: "PATCH",
      url: "/portal/v1/me",
      headers: { cookie: tenantB.cookieHeader, "x-haggles-csrf": tenantB.csrfToken },
      payload: { is_buyer: true, is_seller: true },
    });

    // Create resources under Tenant A
    facilitator.creditWalletTopup({
      walletId: walletA,
      topupId: "top_tenant_a_1",
      grossAmountMicros: 20_000_000n,
      paypalFeeMicros: 500_000n,
    });

    const keyARes = await app.inject({
      method: "POST",
      url: "/portal/v1/buyer/keys",
      headers: { cookie: tenantA.cookieHeader, "x-haggles-csrf": tenantA.csrfToken },
      payload: { name: "Tenant A Agent Key" },
    });
    const keyA = keyARes.json<{ id: string; key: string }>();

    const sellerKeyARes = await app.inject({
      method: "POST",
      url: "/portal/v1/seller/keys",
      headers: { cookie: tenantA.cookieHeader, "x-haggles-csrf": tenantA.csrfToken },
      payload: { name: "Tenant A Seller Key" },
    });
    const sellerKeyA = sellerKeyARes.json<{ id: string; key: string }>();

    const topupARes = await app.inject({
      method: "POST",
      url: "/portal/v1/buyer/topups",
      headers: { cookie: tenantA.cookieHeader, "x-haggles-csrf": tenantA.csrfToken },
      payload: { amount: "10.00" },
    });
    const topupA = topupARes.json<{ id: string }>();

    // Create a captured payment & auto-discovered endpoint on Tenant A
    const authPayA = await facilitator.authorizePayment({
      rawAgentKey: keyA.key,
      idempotencyKey: "chl_01J9Z3IDORTEST000000000001",
      challengeInput: {
        protocol: "haggles",
        version: 1,
        scheme: "prepaid-usd",
        challenge_id: "chl_01J9Z3IDORTEST000000000001",
        amount: "0.05",
        currency: "USD",
        method: "GET",
        url: "https://a.example.com/data",
        seller_id: sellerA,
        facilitator: config.PUBLIC_API_URL,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    await facilitator.redeemPayment({
      rawSellerKey: sellerKeyA.key,
      idempotencyKey: "red_idor_1",
      paymentId: authPayA.payment_id,
      token: authPayA.token,
      method: "GET",
      url: "https://a.example.com/data",
      amount: "0.05",
      route: "/data",
    });
    const endpointsA = facilitator.getSellerEndpoints(sellerA);
    const endpointAId = endpointsA[0]!.id;

    // Now Tenant B attempts to read/mutate every single {id} resource of Tenant A -> all MUST return 404
    const idorChecks = [
      await app.inject({
        method: "GET",
        url: `/portal/v1/buyer/keys/${keyA.id}`,
        headers: { cookie: tenantB.cookieHeader },
      }),
      await app.inject({
        method: "PATCH",
        url: `/portal/v1/buyer/keys/${keyA.id}`,
        headers: { cookie: tenantB.cookieHeader, "x-haggles-csrf": tenantB.csrfToken },
        payload: { name: "Hijacked" },
      }),
      await app.inject({
        method: "POST",
        url: `/portal/v1/buyer/keys/${keyA.id}/revoke`,
        headers: { cookie: tenantB.cookieHeader, "x-haggles-csrf": tenantB.csrfToken },
      }),
      await app.inject({
        method: "GET",
        url: `/portal/v1/buyer/payments/${authPayA.payment_id}`,
        headers: { cookie: tenantB.cookieHeader },
      }),
      await app.inject({
        method: "POST",
        url: `/portal/v1/buyer/topups/${topupA.id}/capture`,
        headers: { cookie: tenantB.cookieHeader, "x-haggles-csrf": tenantB.csrfToken },
      }),
      await app.inject({
        method: "PATCH",
        url: `/portal/v1/seller/endpoints/${endpointAId}`,
        headers: { cookie: tenantB.cookieHeader, "x-haggles-csrf": tenantB.csrfToken },
        payload: { display_name: "Hijacked Endpoint" },
      }),
      await app.inject({
        method: "POST",
        url: `/portal/v1/seller/keys/${sellerKeyA.id}/revoke`,
        headers: { cookie: tenantB.cookieHeader, "x-haggles-csrf": tenantB.csrfToken },
      }),
    ];

    for (const res of idorChecks) {
      expect(res.statusCode).toBe(404);
    }

    await app.close();
  });
});
