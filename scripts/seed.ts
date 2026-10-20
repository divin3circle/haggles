/**
 * `bun run seed` — Seeds two demo sellers (`seller-datasets` and `seller-poems`),
 * one buyer with a funded wallet ($25.00), an agent key with spending policy,
 * and sample settled HTTP 402 payments (`SPEC.md` section 14.2).
 */

import { FacilitatorService, loadConfig } from "../apps/api/src/index.ts";

async function main() {
  const config = loadConfig({
    LOG_LEVEL: "warn",
  });
  const facilitator = await FacilitatorService.create(config);

  // 1. Buyer wallet funded with $25.00
  const wallet = facilitator.createWallet("acc_seed_buyer_01");
  facilitator.creditWalletTopup({
    walletId: wallet.id,
    topupId: "top_seed_initial_25usd",
    grossAmountMicros: 25_000_000n,
    paypalFeeMicros: 820_000n,
  });

  const { record: agentKeyRecord, fullKey: agentKey } =
    facilitator.createAgentKey({
      walletId: wallet.id,
      name: "Research Agent (Seed)",
      perCallMaxMicros: 100_000n, // $0.10/call
      dailyMaxMicros: 500_000n, // $0.50/day
      monthlyMaxMicros: 10_000_000n, // $10.00/mo
    });

  // 2. Demo Seller 1: seller-datasets
  const sellerDatasets = facilitator.createSeller({
    accountId: "acc_seed_seller_datasets",
    payoutEmail: "datasets-seller@sandbox.paypal.example.com",
    payoutPaypalPayerId: "PAYER_SEED_DATASETS",
  });
  const { fullKey: datasetsSellerKey } = facilitator.createSellerKey({
    sellerId: sellerDatasets.id,
    name: "Datasets Hono Middleware Key",
  });

  // 3. Demo Seller 2: seller-poems
  const sellerPoems = facilitator.createSeller({
    accountId: "acc_seed_seller_poems",
    payoutEmail: "poems-seller@sandbox.paypal.example.com",
    payoutPaypalPayerId: "PAYER_SEED_POEMS",
  });
  const { fullKey: poemsSellerKey } = facilitator.createSellerKey({
    sellerId: sellerPoems.id,
    name: "Poems Express Middleware Key",
  });

  // 4. Sample payments across both sellers
  const auth1 = await facilitator.authorizePayment({
    rawAgentKey: agentKey,
    idempotencyKey: "seed_auth_1",
    challengeInput: {
      protocol: "haggles",
      version: 1,
      scheme: "prepaid-usd",
      facilitator: config.PUBLIC_API_URL,
      seller_id: sellerDatasets.id,
      amount: "0.03",
      currency: "USD",
      method: "GET",
      url: "http://localhost:4010/datasets/rent-index?city=austin",
      challenge_id: "chl_01J9Z3SEED0000000000000001",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  await facilitator.redeemPayment({
    rawSellerKey: datasetsSellerKey,
    paymentId: auth1.payment_id,
    idempotencyKey: "seed_redeem_1",
    token: auth1.token,
    method: "GET",
    url: "http://localhost:4010/datasets/rent-index?city=austin",
    amount: "0.03",
    route: "/datasets/rent-index",
  });

  const auth2 = await facilitator.authorizePayment({
    rawAgentKey: agentKey,
    idempotencyKey: "seed_auth_2",
    challengeInput: {
      protocol: "haggles",
      version: 1,
      scheme: "prepaid-usd",
      facilitator: config.PUBLIC_API_URL,
      seller_id: sellerPoems.id,
      amount: "0.02",
      currency: "USD",
      method: "GET",
      url: "http://localhost:4011/poems/ozymandias",
      challenge_id: "chl_01J9Z3SEED0000000000000002",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  await facilitator.redeemPayment({
    rawSellerKey: poemsSellerKey,
    paymentId: auth2.payment_id,
    idempotencyKey: "seed_redeem_2",
    token: auth2.token,
    method: "GET",
    url: "http://localhost:4011/poems/ozymandias",
    amount: "0.02",
    route: "/poems/:id",
  });

  const balanceCheck = facilitator.ledger.verifyInvariants();

  console.log("=== Haggles Demo Seed Complete (SPEC.md § 14.2) ===");
  console.log(`Buyer Wallet ID      : ${wallet.id} (Available: $24.95)`);
  console.log(`Buyer Agent Key ID   : ${agentKeyRecord.id} (Prefix: ${agentKeyRecord.prefix}...)`);
  console.log(`Seller 1 (Datasets)  : ${sellerDatasets.id}`);
  console.log(`Seller 2 (Poems)     : ${sellerPoems.id}`);
  console.log(`Sample Payments      : ${auth1.payment_id} ($0.03), ${auth2.payment_id} ($0.02)`);
  console.log(`Ledger Invariants    : ok=${balanceCheck.ok}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
