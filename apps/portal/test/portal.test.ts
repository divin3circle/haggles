import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { portalApi } from "@/lib/portal-api";
import { buildPortalCsp, proxy } from "@/proxy";

describe("@haggles/portal CSP & Buyer/Seller state workflows (SPEC.md §§ 8.2, 11.4, 11.5)", () => {
  it("builds a strict Content-Security-Policy with per-response cryptographic nonce and PayPal JS SDK domains", () => {
    const csp = buildPortalCsp("testNonce123");
    expect(csp).toContain("script-src 'self' 'nonce-testNonce123' https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com");
    expect(csp).toContain("frame-src https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("attaches Content-Security-Policy and X-Nonce headers in Next.js 16 proxy", () => {
    const req = new NextRequest("http://localhost:3000/buy/wallet");
    const res = proxy(req);
    const csp = res.headers.get("Content-Security-Policy");
    const nonce = res.headers.get("x-nonce");
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("enforces $5.00 min and $100.00 max on buyer wallet top-ups and updates available balance", async () => {
    await expect(portalApi.createAndCaptureTopup("2.00")).rejects.toThrow(/between \$5\.00 and \$100\.00/);
    await expect(portalApi.createAndCaptureTopup("250.00")).rejects.toThrow(/between \$5\.00 and \$100\.00/);

    const before = await portalApi.getBuyerSummary();
    const topup = await portalApi.createAndCaptureTopup("10.00");
    expect(topup.status).toBe("credited");
    expect(topup.amount).toBe("10.00");

    const after = await portalApi.getBuyerSummary();
    expect(Number(after.available)).toBeCloseTo(Number(before.available) + 10, 2);
  });

  it("creates, updates policy, and revokes buyer agent keys", async () => {
    const created = await portalApi.createBuyerKey({
      name: "unit-test-agent",
      per_call_max: "0.25",
      daily_max: "10.00",
      allowed_hosts: ["datasets.example.com"],
    });
    expect(created.key.startsWith("hgk_test_")).toBe(true);
    expect(created.per_call_max).toBe("0.25");

    const updated = await portalApi.updateBuyerKey(created.id, {
      daily_max: "15.00",
    });
    expect(updated.daily_max).toBe("15.00");

    await portalApi.revokeBuyerKey(created.id);
    const list = await portalApi.listBuyerKeys();
    const revoked = list.find((k) => k.id === created.id);
    expect(revoked?.status).toBe("revoked");
  });

  it("enforces the 2-active-key cap on seller keys and supports rotation", async () => {
    const initial = await portalApi.listSellerKeys();
    for (const k of initial) {
      if (k.status === "active") {
        await portalApi.revokeSellerKey(k.id);
      }
    }

    const k1 = await portalApi.createSellerKey("primary");
    const k2 = await portalApi.createSellerKey("secondary");
    expect(k1.key.startsWith("hgs_test_")).toBe(true);
    expect(k2.key.startsWith("hgs_test_")).toBe(true);

    await expect(portalApi.createSellerKey("third-key")).rejects.toThrow(/Maximum of 2 active seller keys/);

    await portalApi.revokeSellerKey(k1.id);
    const k3 = await portalApi.createSellerKey("rotated-key");
    expect(k3.status).toBe("active");
  });

  it("sweeps whole cents on seller payout requests and keeps sub-cent dust in pending", async () => {
    const summaryBefore = await portalApi.getSellerSummary();
    expect(Number(summaryBefore.pending)).toBeGreaterThanOrEqual(1);

    const payout = await portalApi.requestSellerPayout();
    expect(payout.status).toBe("succeeded");
    expect(payout.amount).toBe("3.20");

    const summaryAfter = await portalApi.getSellerSummary();
    // $3.2015 -> $3.20 swept, $0.0015 dust remains in pending
    expect(summaryAfter.pending).toBe("0.0015");
  });
});
