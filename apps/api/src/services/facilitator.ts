/**
 * Core facilitator payment, policy, wallet, and signing service.
 *
 * Implements SPEC.md sections 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.3, 6.2, 6.3, 8.1, 8.4, and 8.5.
 */

import {
  type Challenge,
  ChallengeSchema,
  canonicalizeUrl,
  computePlatformFeeMicros,
  createId,
  formatMoney,
  HagglesError,
  InsufficientFundsError,
  InvalidChallengeError,
  type PaymentTokenClaims,
  PolicyViolationError,
  parseMoney,
  type ReceiptClaims,
} from "@haggles/core";
import type { JWK } from "jose";
import type { ApiConfig } from "../config.js";
import {
  buildCapturePostingPlan,
  buildHoldPostingPlan,
  buildPayoutDonePostingPlan,
  buildPayoutFailPostingPlan,
  buildPayoutFeePostingPlan,
  buildPayoutReversedPostingPlan,
  buildPayoutStartPostingPlan,
  buildRefundPostingPlan,
  buildReleasePostingPlan,
  buildTopupPostingPlan,
  InMemoryLedger,
  type LedgerInvariantReport,
  sellerPayoutAccountId,
  sellerPendingAccountId,
  walletAvailAccountId,
  walletHeldAccountId,
} from "../ledger/index.js";
import {
  computeAgentRef,
  generateApiKey,
  generateSigningKeyRecord,
  parseApiKey,
  type SigningKeyRecord,
  signPaymentToken,
  signReceipt,
  verifyApiKeyHash,
  verifyPaymentTokenJws,
} from "./crypto.js";

const HOLD_TTL_SECONDS = 120;
const TOKEN_TTL_SECONDS = 60;
const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETIRED_KEY_PUBLISH_MS = 24 * 60 * 60 * 1000;

/**
 * Stored buyer wallet record (SPEC.md section 6.1).
 *
 * @example
 * ```ts
 * const wallet: WalletRecord = { id: "wal_01J...", accountId: "acc_01J...", status: "active", createdAt: new Date() };
 * ```
 */
export interface WalletRecord {
  id: string;
  accountId: string;
  status: "active" | "frozen";
  createdAt: Date;
}

/**
 * Stored agent key and spending policy record (SPEC.md sections 5.3 and 6.1).
 *
 * @example
 * ```ts
 * console.log(key.perCallMaxMicros); // 100000n
 * ```
 */
export interface AgentKeyRecord {
  id: string;
  walletId: string;
  name: string;
  prefix: string;
  keyHash: string;
  perCallMaxMicros: bigint;
  dailyMaxMicros: bigint;
  monthlyMaxMicros: bigint | null;
  allowedSellers: string[] | null;
  allowedHosts: string[] | null;
  expiresAt: Date | null;
  status: "active" | "revoked";
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * Stored seller profile record (SPEC.md section 6.1).
 *
 * @example
 * ```ts
 * console.log(seller.status); // "active"
 * ```
 */
export interface SellerRecord {
  id: string;
  accountId: string;
  status: "active" | "paused";
  payoutPaypalPayerId: string;
  payoutEmail: string;
  payoutMode: "paypal" | "simulated";
  createdAt: Date;
}

/**
 * Stored seller API key record (SPEC.md section 6.1).
 *
 * @example
 * ```ts
 * console.log(sellerKey.prefix); // "hgs_test_..."
 * ```
 */
export interface SellerKeyRecord {
  id: string;
  sellerId: string;
  name: string;
  prefix: string;
  keyHash: string;
  status: "active" | "revoked";
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * Stored seller endpoint record (SPEC.md section 6.1).
 *
 * @example
 * ```ts
 * console.log(endpoint.route); // "/poems/:id"
 * ```
 */
export interface EndpointRecord {
  id: string;
  sellerId: string;
  method: string;
  route: string;
  displayName: string | null;
  description: string | null;
  lastPriceMicros: bigint;
  status: "active" | "hidden";
  createdAt: Date;
}

/**
 * Stored payment record matching the `payments` table (SPEC.md sections 4.8 and 6.1).
 *
 * @example
 * ```ts
 * console.log(payment.status); // "authorized"
 * ```
 */
export interface PaymentRecord {
  id: string;
  walletId: string;
  agentKeyId: string;
  sellerId: string;
  endpointId: string | null;
  amountMicros: bigint;
  feeMicros: bigint;
  method: string;
  url: string;
  challengeId: string;
  status: "authorized" | "captured" | "released" | "refunded";
  authorizedAt: Date;
  expiresAt: Date;
  capturedAt: Date | null;
  releasedAt: Date | null;
  refundedAt: Date | null;
  idempotencyKey: string;
  redeemIdempotencyKey: string | null;
  redeemRequestFingerprint: string | null;
  token: string;
  receipt: string | null;
  responseStatus: number | null;
  createdAt: Date;
}

/**
 * UTC day (`YYYY-MM-DD`) and UTC month start (`YYYY-MM-01`) strings for a timestamp (SPEC.md section 5.3).
 *
 * @param date - Timestamp (defaults to `new Date()`)
 * @returns `{ dayStart, monthStart }`
 *
 * @example
 * ```ts
 * getUtcSpendPeriods(new Date("2026-10-06T12:00:00Z"));
 * // { dayStart: "2026-10-06", monthStart: "2026-10-01" }
 * ```
 */
export function getUtcSpendPeriods(date: Date = new Date()): {
  dayStart: string;
  monthStart: string;
} {
  const iso = date.toISOString();
  const dayStart = iso.slice(0, 10);
  const monthStart = `${iso.slice(0, 7)}-01`;
  return { dayStart, monthStart };
}

/**
 * Async mutex ensuring single-statement transactional atomicity when running in-memory concurrency tests.
 */
class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.queue;
    this.queue = prev.then(() => next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * Transactional facilitator engine implementing SPEC.md sections 4, 5.1, 5.3, 6.2, 6.3, 8.1, 8.4, and 8.5.
 *
 * @example
 * ```ts
 * const facilitator = await FacilitatorService.create(config);
 * ```
 */
export class FacilitatorService {
  readonly config: ApiConfig;
  readonly ledger: InMemoryLedger;
  private readonly mutex = new AsyncMutex();

  private readonly wallets = new Map<string, WalletRecord>();
  private readonly agentKeysById = new Map<string, AgentKeyRecord>();
  private readonly agentKeysByPrefix = new Map<string, AgentKeyRecord>();
  private readonly sellers = new Map<string, SellerRecord>();
  private readonly sellerKeysById = new Map<string, SellerKeyRecord>();
  private readonly sellerKeysByPrefix = new Map<string, SellerKeyRecord>();
  private readonly endpointsById = new Map<string, EndpointRecord>();
  private readonly endpointsByComposite = new Map<string, EndpointRecord>();
  private readonly paymentsById = new Map<string, PaymentRecord>();
  private readonly paymentsByAgentIdempotency = new Map<string, PaymentRecord>();
  private readonly spendCounters = new Map<string, bigint>();
  private readonly signingKeys = new Map<string, SigningKeyRecord>();

  private constructor(config: ApiConfig) {
    this.config = config;
    this.ledger = new InMemoryLedger();
  }

  /**
   * Creates a {@link FacilitatorService} and initializes an active Ed25519 signing key.
   *
   * @param config - Validated API configuration
   * @returns Initialized {@link FacilitatorService}
   *
   * @example
   * ```ts
   * const service = await FacilitatorService.create(loadConfig());
   * ```
   */
  static async create(config: ApiConfig): Promise<FacilitatorService> {
    const svc = new FacilitatorService(config);
    const keyRecord = await generateSigningKeyRecord(config.MASTER_KEY);
    svc.signingKeys.set(keyRecord.kid, keyRecord);
    return svc;
  }

  /**
   * Rotates the facilitator's active Ed25519 signing key: retires the current active key
   * (keeping it in JWKS for 24 hours) and promotes a newly generated key (SPEC.md section 4.6).
   *
   * @param now - Optional current timestamp
   * @returns Newly activated {@link SigningKeyRecord}
   *
   * @example
   * ```ts
   * const nextKey = await facilitator.rotateSigningKey();
   * ```
   */
  async rotateSigningKey(now: Date = new Date()): Promise<SigningKeyRecord> {
    for (const record of this.signingKeys.values()) {
      if (record.status === "active") {
        record.status = "retired";
        record.retiredAt = now;
      }
    }
    const next = await generateSigningKeyRecord(this.config.MASTER_KEY);
    next.createdAt = now;
    this.signingKeys.set(next.kid, next);
    return next;
  }

  /**
   * Returns the currently active {@link SigningKeyRecord}.
   */
  getActiveSigningKey(): SigningKeyRecord {
    for (const record of this.signingKeys.values()) {
      if (record.status === "active") return record;
    }
    throw new HagglesError("No active facilitator signing key configured.", {
      code: "internal_error",
      status: 500,
    });
  }

  /**
   * Returns all public Ed25519 JWKs eligible for publication in `GET /.well-known/jwks.json`
   * (active keys plus retired keys within 24 hours of retirement, SPEC.md section 4.6).
   *
   * @param now - Optional current timestamp
   * @returns Array of public JWKs
   *
   * @example
   * ```ts
   * const { keys } = facilitator.getJwks();
   * ```
   */
  getJwks(now: Date = new Date()): { keys: Array<JWK & { kid: string; alg: "EdDSA"; use: "sig" }> } {
    const keys: Array<JWK & { kid: string; alg: "EdDSA"; use: "sig" }> = [];
    for (const record of this.signingKeys.values()) {
      if (record.status === "active") {
        keys.push(record.publicJwk);
      } else if (
        record.status === "retired" &&
        record.retiredAt &&
        now.getTime() - record.retiredAt.getTime() <= RETIRED_KEY_PUBLISH_MS
      ) {
        keys.push(record.publicJwk);
      }
    }
    return { keys };
  }

  /**
   * Creates a buyer wallet and initializes its `W_AVAIL` and `W_HELD` ledger accounts.
   *
   * @param accountId - Owner account ID (`acc_...`)
   * @param walletId - Optional explicit wallet ID (`wal_...`)
   * @returns Created {@link WalletRecord}
   *
   * @example
   * ```ts
   * const wallet = facilitator.createWallet("acc_01J...");
   * ```
   */
  createWallet(accountId: string, walletId: string = createId("wal")): WalletRecord {
    const record: WalletRecord = {
      id: walletId,
      accountId,
      status: "active",
      createdAt: new Date(),
    };
    this.wallets.set(record.id, record);
    this.ledger.ensureAccount(walletAvailAccountId(record.id), "W_AVAIL", record.id);
    this.ledger.ensureAccount(walletHeldAccountId(record.id), "W_HELD", record.id);
    return record;
  }

  /**
   * Sets the status of a buyer wallet (`active` or `frozen`, SPEC.md section 7.1 step 7).
   */
  setWalletStatus(walletId: string, status: "active" | "frozen"): void {
    const wallet = this.wallets.get(walletId);
    if (!wallet) {
      throw new HagglesError(`Wallet ${walletId} not found.`, { code: "not_found", status: 404 });
    }
    wallet.status = status;
  }

  /**
   * Credits a buyer wallet via a `TOPUP` ledger posting (SPEC.md sections 6.3 and 7.1).
   *
   * Enforces `TOPUP_MIN_MICROS`, `TOPUP_MAX_MICROS`, and `WALLET_MAX_MICROS` limits (SPEC.md section 2.3).
   *
   * @param params - Top-up parameters
   * @returns `{ topupId, availableMicros, heldMicros, idempotentReplay }`
   *
   * @example
   * ```ts
   * facilitator.creditWalletTopup({
   *   walletId: wallet.id,
   *   topupId: "top_01J...",
   *   grossAmountMicros: 10_000_000n,
   *   paypalFeeMicros: 500_000n,
   * });
   * ```
   */
  creditWalletTopup(params: {
    walletId: string;
    topupId: string;
    grossAmountMicros: bigint;
    paypalFeeMicros: bigint;
  }): { topupId: string; availableMicros: bigint; heldMicros: bigint; idempotentReplay: boolean } {
    const wallet = this.wallets.get(params.walletId);
    if (!wallet) {
      throw new HagglesError("Wallet not found.", { code: "not_found", status: 404 });
    }
    if (
      params.grossAmountMicros < this.config.TOPUP_MIN_MICROS ||
      params.grossAmountMicros > this.config.TOPUP_MAX_MICROS
    ) {
      throw new HagglesError(
        `Top-up amount ${formatMoney(params.grossAmountMicros)} is outside allowed limits (${formatMoney(this.config.TOPUP_MIN_MICROS)}..${formatMoney(this.config.TOPUP_MAX_MICROS)}).`,
        { code: "wallet_limit_exceeded", status: 409 },
      );
    }

    const availId = walletAvailAccountId(wallet.id);
    const heldId = walletHeldAccountId(wallet.id);
    const currentTotal = this.ledger.getBalance(availId) + this.ledger.getBalance(heldId);
    if (currentTotal + params.grossAmountMicros > this.config.WALLET_MAX_MICROS) {
      throw new HagglesError(
        `Top-up of $${formatMoney(params.grossAmountMicros)} would exceed the $${formatMoney(this.config.WALLET_MAX_MICROS)} maximum wallet balance.`,
        { code: "wallet_limit_exceeded", status: 409 },
      );
    }

    const plan = buildTopupPostingPlan(
      wallet.id,
      params.topupId,
      params.grossAmountMicros,
      params.paypalFeeMicros,
    );
    const { idempotentReplay } = this.ledger.post(plan);
    return {
      topupId: params.topupId,
      availableMicros: this.ledger.getBalance(availId),
      heldMicros: this.ledger.getBalance(heldId),
      idempotentReplay,
    };
  }

  /**
   * Creates a seller profile and initializes its `S_PENDING` and `S_PAYOUT` ledger accounts.
   *
   * @example
   * ```ts
   * const seller = facilitator.createSeller({ accountId: "acc_01J...", payoutPaypalPayerId: "PAYER123", payoutEmail: "seller@example.com" });
   * ```
   */
  createSeller(params: {
    accountId: string;
    sellerId?: string | undefined;
    payoutPaypalPayerId: string;
    payoutEmail: string;
    payoutMode?: "paypal" | "simulated" | undefined;
    status?: "active" | "paused" | undefined;
  }): SellerRecord {
    const id = params.sellerId ?? createId("slr");
    const record: SellerRecord = {
      id,
      accountId: params.accountId,
      status: params.status ?? "active",
      payoutPaypalPayerId: params.payoutPaypalPayerId,
      payoutEmail: params.payoutEmail,
      payoutMode: params.payoutMode ?? "paypal",
      createdAt: new Date(),
    };
    this.sellers.set(id, record);
    this.ledger.ensureAccount(sellerPendingAccountId(id), "S_PENDING", id);
    this.ledger.ensureAccount(sellerPayoutAccountId(id), "S_PAYOUT", id);
    return record;
  }

  /**
   * Updates a seller's status (`active` or `paused`).
   */
  setSellerStatus(sellerId: string, status: "active" | "paused"): void {
    const seller = this.sellers.get(sellerId);
    if (!seller) {
      throw new HagglesError("Seller not found.", { code: "seller_not_found", status: 404 });
    }
    seller.status = status;
  }

  /**
   * Issues a new buyer agent key (`hgk_<env>_...`) with spending policy defaults (SPEC.md sections 5.3 and 8.1).
   *
   * @example
   * ```ts
   * const { record, fullKey } = facilitator.createAgentKey({ walletId: wallet.id, name: "research-agent" });
   * ```
   */
  createAgentKey(params: {
    walletId: string;
    name: string;
    perCallMaxMicros?: bigint | undefined;
    dailyMaxMicros?: bigint | undefined;
    monthlyMaxMicros?: bigint | null | undefined;
    allowedSellers?: string[] | null | undefined;
    allowedHosts?: string[] | null | undefined;
    expiresAt?: Date | null | undefined;
  }): { record: AgentKeyRecord; fullKey: string } {
    if (!this.wallets.has(params.walletId)) {
      throw new HagglesError("Wallet not found.", { code: "not_found", status: 404 });
    }
    const { fullKey, prefix, keyHash } = generateApiKey(
      "hgk",
      this.config.HAGGLES_ENV,
      this.config.KEY_PEPPER,
    );
    const record: AgentKeyRecord = {
      id: createId("agk"),
      walletId: params.walletId,
      name: params.name,
      prefix,
      keyHash,
      perCallMaxMicros: params.perCallMaxMicros ?? 100_000n,
      dailyMaxMicros: params.dailyMaxMicros ?? 5_000_000n,
      monthlyMaxMicros: params.monthlyMaxMicros ?? null,
      allowedSellers: params.allowedSellers ?? null,
      allowedHosts: params.allowedHosts
        ? params.allowedHosts.map((h) => h.toLowerCase())
        : null,
      expiresAt: params.expiresAt ?? null,
      status: "active",
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.agentKeysById.set(record.id, record);
    this.agentKeysByPrefix.set(record.prefix, record);
    return { record, fullKey };
  }

  /**
   * Revokes an agent key immediately (SPEC.md section 8.8).
   */
  revokeAgentKey(agentKeyId: string, now: Date = new Date()): void {
    const key = this.agentKeysById.get(agentKeyId);
    if (!key) {
      throw new HagglesError("Agent key not found.", { code: "not_found", status: 404 });
    }
    key.status = "revoked";
    key.revokedAt = now;
  }

  /**
   * Issues a new seller API key (`hgs_<env>_...`), enforcing the maximum of 2 active keys per seller (SPEC.md section 6.1).
   *
   * @example
   * ```ts
   * const { record, fullKey } = facilitator.createSellerKey({ sellerId: seller.id, name: "prod-1" });
   * ```
   */
  createSellerKey(params: {
    sellerId: string;
    name: string;
  }): { record: SellerKeyRecord; fullKey: string } {
    if (!this.sellers.has(params.sellerId)) {
      throw new HagglesError("Seller not found.", { code: "seller_not_found", status: 404 });
    }
    let activeCount = 0;
    for (const sk of this.sellerKeysById.values()) {
      if (sk.sellerId === params.sellerId && sk.status === "active") {
        activeCount++;
      }
    }
    if (activeCount >= 2) {
      throw new HagglesError("Maximum of 2 active seller keys reached; revoke a key to rotate.", {
        code: "forbidden",
        status: 403,
      });
    }
    const { fullKey, prefix, keyHash } = generateApiKey(
      "hgs",
      this.config.HAGGLES_ENV,
      this.config.KEY_PEPPER,
    );
    const record: SellerKeyRecord = {
      id: createId("slk"),
      sellerId: params.sellerId,
      name: params.name,
      prefix,
      keyHash,
      status: "active",
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.sellerKeysById.set(record.id, record);
    this.sellerKeysByPrefix.set(record.prefix, record);
    return { record, fullKey };
  }

  /**
   * Revokes a seller key immediately.
   */
  revokeSellerKey(sellerKeyId: string, now: Date = new Date()): void {
    const key = this.sellerKeysById.get(sellerKeyId);
    if (!key) {
      throw new HagglesError("Seller key not found.", { code: "not_found", status: 404 });
    }
    key.status = "revoked";
    key.revokedAt = now;
  }

  /**
   * Authenticates a bearer `hgk_...` agent key using prefix lookup and `timingSafeEqual` HMAC comparison (SPEC.md section 8.1).
   */
  authenticateAgentKey(rawBearerKey: string | undefined, now: Date = new Date()): AgentKeyRecord {
    if (!rawBearerKey) {
      throw new HagglesError("Missing agent API key.", { code: "unauthorized", status: 401 });
    }
    const parsed = parseApiKey(rawBearerKey);
    if (!parsed || parsed.kind !== "hgk") {
      throw new HagglesError("Malformed agent API key.", { code: "unauthorized", status: 401 });
    }
    if (parsed.env !== this.config.HAGGLES_ENV) {
      throw new HagglesError(
        `Key environment "${parsed.env}" is not accepted by "${this.config.HAGGLES_ENV}" facilitator.`,
        { code: "key_revoked", status: 401 },
      );
    }
    const record = this.agentKeysByPrefix.get(parsed.prefix);
    if (!record || !verifyApiKeyHash(rawBearerKey, record.keyHash, this.config.KEY_PEPPER)) {
      throw new HagglesError("Unknown agent API key.", { code: "key_revoked", status: 401 });
    }
    if (record.status !== "active") {
      throw new HagglesError("Agent API key has been revoked.", {
        code: "key_revoked",
        status: 401,
      });
    }
    if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
      throw new HagglesError("Agent API key has expired (expires_at).", {
        code: "key_revoked",
        status: 401,
      });
    }
    record.lastUsedAt = now;
    return record;
  }

  /**
   * Authenticates a bearer `hgs_...` seller key using prefix lookup and `timingSafeEqual` HMAC comparison (SPEC.md section 8.1).
   */
  authenticateSellerKey(rawBearerKey: string | undefined, now: Date = new Date()): SellerKeyRecord {
    if (!rawBearerKey) {
      throw new HagglesError("Missing seller API key.", { code: "unauthorized", status: 401 });
    }
    const parsed = parseApiKey(rawBearerKey);
    if (!parsed || parsed.kind !== "hgs") {
      throw new HagglesError("Malformed seller API key.", { code: "unauthorized", status: 401 });
    }
    if (parsed.env !== this.config.HAGGLES_ENV) {
      throw new HagglesError(
        `Key environment "${parsed.env}" is not accepted by "${this.config.HAGGLES_ENV}" facilitator.`,
        { code: "key_revoked", status: 401 },
      );
    }
    const record = this.sellerKeysByPrefix.get(parsed.prefix);
    if (!record || !verifyApiKeyHash(rawBearerKey, record.keyHash, this.config.KEY_PEPPER)) {
      throw new HagglesError("Unknown seller API key.", { code: "key_revoked", status: 401 });
    }
    if (record.status !== "active") {
      throw new HagglesError("Seller API key has been revoked.", {
        code: "key_revoked",
        status: 401,
      });
    }
    record.lastUsedAt = now;
    return record;
  }

  private spendKey(agentKeyId: string, kind: "day" | "month", periodStart: string): string {
    return `${agentKeyId}:${kind}:${periodStart}`;
  }

  private getSpentMicros(agentKeyId: string, kind: "day" | "month", periodStart: string): bigint {
    return this.spendCounters.get(this.spendKey(agentKeyId, kind, periodStart)) ?? 0n;
  }

  private decrementSpendCounters(agentKeyId: string, authorizedAt: Date, amountMicros: bigint): void {
    const { dayStart, monthStart } = getUtcSpendPeriods(authorizedAt);
    const dKey = this.spendKey(agentKeyId, "day", dayStart);
    const mKey = this.spendKey(agentKeyId, "month", monthStart);
    const dPrev = this.spendCounters.get(dKey) ?? 0n;
    const mPrev = this.spendCounters.get(mKey) ?? 0n;
    this.spendCounters.set(dKey, dPrev > amountMicros ? dPrev - amountMicros : 0n);
    this.spendCounters.set(mKey, mPrev > amountMicros ? mPrev - amountMicros : 0n);
  }

  /**
   * Authorizes a payment (`POST /v1/payments`, SPEC.md sections 4.7, 5.1, 5.3, 6.3).
   *
   * Executes atomically inside the transaction lock:
   * 1. Authenticate agent key and check wallet status.
   * 2. Validate challenge schema, price limits, URL canonicalization, and seller status.
   * 3. Check `(agent_key_id, idempotency_key)` idempotency.
   * 4. Enforce spending policies (`allowed_sellers`, `allowed_hosts`, `per_call_max`, `daily_max`, `monthly_max`).
   * 5. Post `HOLD` (`W_AVAIL → W_HELD`), persist `authorized` payment, and sign Ed25519 payment token.
   */
  async authorizePayment(params: {
    rawAgentKey: string | undefined;
    idempotencyKey: string | undefined;
    challengeInput: unknown;
    now?: Date | undefined;
  }): Promise<{
    payment_id: string;
    token: string;
    amount: string;
    currency: "USD";
    expires_at: string;
  }> {
    return this.mutex.runExclusive(async () => {
      const now = params.now ?? new Date();
      const agentKey = this.authenticateAgentKey(params.rawAgentKey, now);

      const wallet = this.wallets.get(agentKey.walletId);
      if (!wallet) {
        throw new HagglesError("Wallet not found.", { code: "not_found", status: 404 });
      }
      if (wallet.status === "frozen") {
        throw new HagglesError("Wallet is frozen due to a payment reversal or risk event.", {
          code: "wallet_frozen",
          status: 403,
        });
      }

      if (!params.idempotencyKey || params.idempotencyKey.trim() === "") {
        throw new InvalidChallengeError("Idempotency-Key header is required.");
      }
      const idempotencyKey = params.idempotencyKey.trim();

      const parsedChallenge = ChallengeSchema.safeParse(params.challengeInput);
      if (!parsedChallenge.success) {
        throw new InvalidChallengeError(
          `Challenge validation failed: ${parsedChallenge.error.message}`,
        );
      }
      const challenge: Challenge = parsedChallenge.data;
      const canonicalUrl = canonicalizeUrl(challenge.url);
      const amountMicros = parseMoney(challenge.amount);

      if (
        amountMicros < this.config.PRICE_MIN_MICROS ||
        amountMicros > this.config.PRICE_MAX_MICROS
      ) {
        throw new InvalidChallengeError(
          `Challenge amount $${formatMoney(amountMicros)} is outside allowed limits ($${formatMoney(this.config.PRICE_MIN_MICROS)}..$${formatMoney(this.config.PRICE_MAX_MICROS)}).`,
        );
      }

      const challengeExpiryMs = Date.parse(challenge.expires_at);
      if (Number.isNaN(challengeExpiryMs) || challengeExpiryMs + 5_000 < now.getTime()) {
        throw new InvalidChallengeError("Challenge expires_at is already in the past.");
      }

      // Step 3: Idempotency check on (agent_key_id, idempotency_key)
      const idemComposite = `${agentKey.id}:${idempotencyKey}`;
      const existingPayment = this.paymentsByAgentIdempotency.get(idemComposite);
      if (existingPayment) {
        if (
          existingPayment.challengeId !== challenge.challenge_id ||
          existingPayment.amountMicros !== amountMicros ||
          existingPayment.method !== challenge.method ||
          existingPayment.url !== canonicalUrl ||
          existingPayment.sellerId !== challenge.seller_id
        ) {
          throw new HagglesError(
            "Idempotency-Key was already used with a different challenge payload.",
            { code: "idempotency_conflict", status: 422 },
          );
        }
        return {
          payment_id: existingPayment.id,
          token: existingPayment.token,
          amount: formatMoney(existingPayment.amountMicros),
          currency: "USD",
          expires_at: existingPayment.expiresAt.toISOString(),
        };
      }

      // Check seller existence and status
      const seller = this.sellers.get(challenge.seller_id);
      if (!seller) {
        throw new HagglesError(`Seller "${challenge.seller_id}" does not exist.`, {
          code: "seller_not_found",
          status: 404,
        });
      }
      if (seller.status === "paused") {
        throw new HagglesError(`Seller "${challenge.seller_id}" is currently paused.`, {
          code: "seller_paused",
          status: 409,
        });
      }

      // Step 4: Policy checks (SPEC 5.3)
      if (agentKey.allowedSellers && !agentKey.allowedSellers.includes(challenge.seller_id)) {
        throw new PolicyViolationError(
          `Policy violation (allowed_sellers): seller ${challenge.seller_id} is not permitted for key "${agentKey.name}".`,
        );
      }

      const requestHost = new URL(canonicalUrl).hostname.toLowerCase();
      if (agentKey.allowedHosts && !agentKey.allowedHosts.includes(requestHost)) {
        throw new PolicyViolationError(
          `Policy violation (allowed_hosts): host "${requestHost}" is not permitted for key "${agentKey.name}".`,
        );
      }

      if (amountMicros > agentKey.perCallMaxMicros) {
        throw new PolicyViolationError(
          `Policy violation (per_call_max): call price $${formatMoney(amountMicros)} exceeds per-call limit of $${formatMoney(agentKey.perCallMaxMicros)}; raise the limit in Buy -> Keys.`,
        );
      }

      const { dayStart, monthStart } = getUtcSpendPeriods(now);
      const dayCounterKey = this.spendKey(agentKey.id, "day", dayStart);
      const currentDaySpent = this.spendCounters.get(dayCounterKey) ?? 0n;
      if (currentDaySpent + amountMicros > agentKey.dailyMaxMicros) {
        throw new PolicyViolationError(
          `Policy violation (daily_max): daily limit of $${formatMoney(agentKey.dailyMaxMicros)} reached; raise the limit in Buy -> Keys.`,
        );
      }

      const monthCounterKey = this.spendKey(agentKey.id, "month", monthStart);
      const currentMonthSpent = this.spendCounters.get(monthCounterKey) ?? 0n;
      if (
        agentKey.monthlyMaxMicros !== null &&
        currentMonthSpent + amountMicros > agentKey.monthlyMaxMicros
      ) {
        throw new PolicyViolationError(
          `Policy violation (monthly_max): monthly limit of $${formatMoney(agentKey.monthlyMaxMicros)} reached; raise the limit in Buy -> Keys.`,
        );
      }

      // Step 5: Atomic balance move W_AVAIL -> W_HELD
      const paymentId = createId("pay", now.getTime());
      const availBalance = this.ledger.getBalance(walletAvailAccountId(wallet.id));
      if (availBalance < amountMicros) {
        throw new InsufficientFundsError(
          `Available balance ${formatMoney(availBalance)} is less than ${formatMoney(amountMicros)}.`,
        );
      }

      this.ledger.post(buildHoldPostingPlan(wallet.id, paymentId, amountMicros));

      // Commit spend counter increments in same atomic step
      this.spendCounters.set(dayCounterKey, currentDaySpent + amountMicros);
      this.spendCounters.set(monthCounterKey, currentMonthSpent + amountMicros);

      // Step 6 & 7: Sign token and store payment
      const iat = Math.floor(now.getTime() / 1000);
      const tokenExp = iat + TOKEN_TTL_SECONDS;
      const holdExpiresAt = new Date(now.getTime() + HOLD_TTL_SECONDS * 1000);
      const canonicalAmount = formatMoney(amountMicros);

      const tokenClaims: PaymentTokenClaims = {
        iss: this.config.PUBLIC_API_URL,
        aud: seller.id,
        sub: paymentId,
        iat,
        exp: tokenExp,
        amount: canonicalAmount,
        currency: "USD",
        method: challenge.method,
        url: canonicalUrl,
        chl: challenge.challenge_id,
      };

      const activeSigningKey = this.getActiveSigningKey();
      const token = await signPaymentToken(
        tokenClaims,
        activeSigningKey,
        this.config.MASTER_KEY,
      );

      const paymentRecord: PaymentRecord = {
        id: paymentId,
        walletId: wallet.id,
        agentKeyId: agentKey.id,
        sellerId: seller.id,
        endpointId: null,
        amountMicros,
        feeMicros: 0n,
        method: challenge.method,
        url: canonicalUrl,
        challengeId: challenge.challenge_id,
        status: "authorized",
        authorizedAt: now,
        expiresAt: holdExpiresAt,
        capturedAt: null,
        releasedAt: null,
        refundedAt: null,
        idempotencyKey,
        redeemIdempotencyKey: null,
        redeemRequestFingerprint: null,
        token,
        receipt: null,
        responseStatus: null,
        createdAt: now,
      };

      this.paymentsById.set(paymentRecord.id, paymentRecord);
      this.paymentsByAgentIdempotency.set(idemComposite, paymentRecord);

      return {
        payment_id: paymentRecord.id,
        token,
        amount: canonicalAmount,
        currency: "USD",
        expires_at: holdExpiresAt.toISOString(),
      };
    });
  }

  /**
   * Redeems (captures) an authorized payment (`POST /v1/payments/{id}/redeem`, SPEC.md sections 4.7, 4.8, 5.1, 6.3).
   */
  async redeemPayment(params: {
    rawSellerKey: string | undefined;
    idempotencyKey: string | undefined;
    paymentId: string;
    token: string;
    method: string;
    url: string;
    amount: string;
    route?: string | undefined;
    now?: Date | undefined;
  }): Promise<{
    payment_id: string;
    status: "captured";
    amount: string;
    seller_net: string;
    receipt: string;
  }> {
    return this.mutex.runExclusive(async () => {
      const now = params.now ?? new Date();
      const sellerKey = this.authenticateSellerKey(params.rawSellerKey, now);

      if (!params.idempotencyKey || params.idempotencyKey.trim() === "") {
        throw new InvalidChallengeError("Idempotency-Key header is required.");
      }
      const idempotencyKey = params.idempotencyKey.trim();

      const payment = this.paymentsById.get(params.paymentId);
      if (!payment || payment.sellerId !== sellerKey.sellerId) {
        throw new HagglesError("Payment not found.", { code: "not_found", status: 404 });
      }

      const canonicalReqUrl = canonicalizeUrl(params.url);
      const reqAmountMicros = parseMoney(params.amount);
      const fingerprint = `${params.token}|${params.method}|${canonicalReqUrl}|${reqAmountMicros.toString()}|${params.route ?? ""}`;

      // Check idempotent replay if already captured
      if (payment.status === "captured") {
        if (payment.redeemIdempotencyKey === idempotencyKey) {
          if (payment.redeemRequestFingerprint !== fingerprint) {
            throw new HagglesError(
              "Idempotency-Key was already used with a different redeem payload.",
              { code: "idempotency_conflict", status: 422 },
            );
          }
          const sellerNetMicros = payment.amountMicros - payment.feeMicros;
          return {
            payment_id: payment.id,
            status: "captured",
            amount: formatMoney(payment.amountMicros),
            seller_net: formatMoney(sellerNetMicros),
            receipt: payment.receipt!,
          };
        }
        throw new HagglesError("Payment has already been redeemed.", {
          code: "already_redeemed",
          status: 409,
        });
      }

      if (payment.status === "released") {
        throw new HagglesError("Payment hold has already expired and been released.", {
          code: "token_expired",
          status: 410,
        });
      }

      if (payment.status === "refunded") {
        throw new HagglesError("Payment has already been captured and refunded.", {
          code: "already_redeemed",
          status: 409,
        });
      }

      // Verify JWS token signature and claims
      const { claims } = await verifyPaymentTokenJws(params.token, this.getJwks(now).keys);
      if (claims.sub !== payment.id || claims.aud !== sellerKey.sellerId) {
        throw new HagglesError("Payment token subject or audience does not match.", {
          code: "request_mismatch",
          status: 409,
        });
      }

      // Check token expiry or hold expiry (lazy release on redeem, SPEC 4.8)
      const nowSec = Math.floor(now.getTime() / 1000);
      if (claims.exp <= nowSec || payment.expiresAt.getTime() <= now.getTime()) {
        this.releasePaymentInternal(payment, now);
        throw new HagglesError("Payment token or hold has expired.", {
          code: "token_expired",
          status: 410,
        });
      }

      // Verify amount and method/URL match stored authorization (SPEC 5.1)
      if (reqAmountMicros !== payment.amountMicros || parseMoney(claims.amount) !== payment.amountMicros) {
        throw new HagglesError(
          `Redeem amount $${formatMoney(reqAmountMicros)} does not match authorized amount $${formatMoney(payment.amountMicros)}.`,
          { code: "amount_mismatch", status: 409 },
        );
      }

      if (
        params.method !== payment.method ||
        canonicalReqUrl !== payment.url ||
        claims.method !== payment.method ||
        claims.url !== payment.url
      ) {
        throw new HagglesError("Redeem method or URL does not match authorized payment.", {
          code: "request_mismatch",
          status: 409,
        });
      }

      // Upsert seller endpoint (SPEC 2.1 D7 and 6.1)
      const routePattern =
        params.route && params.route.trim().length > 0
          ? params.route.trim().slice(0, 200)
          : new URL(payment.url).pathname;
      const endpointComposite = `${payment.sellerId}:${payment.method}:${routePattern}`;
      let endpoint = this.endpointsByComposite.get(endpointComposite);
      if (!endpoint) {
        endpoint = {
          id: createId("ep", now.getTime()),
          sellerId: payment.sellerId,
          method: payment.method,
          route: routePattern,
          displayName: null,
          description: null,
          lastPriceMicros: payment.amountMicros,
          status: "active",
          createdAt: now,
        };
        this.endpointsById.set(endpoint.id, endpoint);
        this.endpointsByComposite.set(endpointComposite, endpoint);
      } else {
        endpoint.lastPriceMicros = payment.amountMicros;
      }

      // Compute platform fee and post CAPTURE (SPEC 6.3)
      const feeMicros = computePlatformFeeMicros(
        payment.amountMicros,
        this.config.PLATFORM_FEE_BPS,
      );
      const sellerNetMicros = payment.amountMicros - feeMicros;

      this.ledger.post(
        buildCapturePostingPlan(
          payment.walletId,
          payment.sellerId,
          payment.id,
          payment.amountMicros,
          feeMicros,
        ),
      );

      const receiptClaims: ReceiptClaims = {
        iss: this.config.PUBLIC_API_URL,
        sub: payment.id,
        aud: payment.sellerId,
        iat: nowSec,
        amount: formatMoney(payment.amountMicros),
        currency: "USD",
        method: payment.method,
        url: payment.url,
        captured_at: now.toISOString(),
      };
      const receipt = await signReceipt(
        receiptClaims,
        this.getActiveSigningKey(),
        this.config.MASTER_KEY,
      );

      payment.status = "captured";
      payment.feeMicros = feeMicros;
      payment.endpointId = endpoint.id;
      payment.capturedAt = now;
      payment.redeemIdempotencyKey = idempotencyKey;
      payment.redeemRequestFingerprint = fingerprint;
      payment.receipt = receipt;

      return {
        payment_id: payment.id,
        status: "captured",
        amount: formatMoney(payment.amountMicros),
        seller_net: formatMoney(sellerNetMicros),
        receipt,
      };
    });
  }

  /**
   * Refunds a captured payment within the 24-hour refund window (`POST /v1/payments/{id}/refund`, SPEC.md sections 4.8, 5.1, 6.3, 7.4).
   *
   * Idempotent by payment ID.
   */
  async refundPayment(params: {
    rawSellerKey: string | undefined;
    paymentId: string;
    reason: "handler_error" | "seller_initiated";
    now?: Date | undefined;
  }): Promise<{
    payment_id: string;
    status: "refunded";
    amount: string;
    refunded_at: string;
  }> {
    return this.mutex.runExclusive(async () => {
      const now = params.now ?? new Date();
      const sellerKey = this.authenticateSellerKey(params.rawSellerKey, now);

      const payment = this.paymentsById.get(params.paymentId);
      if (!payment || payment.sellerId !== sellerKey.sellerId) {
        throw new HagglesError("Payment not found.", { code: "not_found", status: 404 });
      }

      if (payment.status === "refunded") {
        return {
          payment_id: payment.id,
          status: "refunded",
          amount: formatMoney(payment.amountMicros),
          refunded_at: payment.refundedAt!.toISOString(),
        };
      }

      if (payment.status !== "captured" || !payment.capturedAt) {
        throw new HagglesError(
          `Refund is only allowed for captured payments (current status: ${payment.status}).`,
          { code: "refund_not_allowed", status: 409 },
        );
      }

      if (now.getTime() - payment.capturedAt.getTime() > REFUND_WINDOW_MS) {
        throw new HagglesError("Refund window (24 hours after capture) has passed.", {
          code: "refund_not_allowed",
          status: 409,
        });
      }

      this.ledger.post(
        buildRefundPostingPlan(
          payment.walletId,
          payment.sellerId,
          payment.id,
          payment.amountMicros,
          payment.feeMicros,
        ),
      );

      this.decrementSpendCounters(payment.agentKeyId, payment.authorizedAt, payment.amountMicros);

      payment.status = "refunded";
      payment.refundedAt = now;

      return {
        payment_id: payment.id,
        status: "refunded",
        amount: formatMoney(payment.amountMicros),
        refunded_at: now.toISOString(),
      };
    });
  }

  private releasePaymentInternal(payment: PaymentRecord, now: Date): void {
    if (payment.status !== "authorized") return;
    this.ledger.post(buildReleasePostingPlan(payment.walletId, payment.id, payment.amountMicros));
    this.decrementSpendCounters(payment.agentKeyId, payment.authorizedAt, payment.amountMicros);
    payment.status = "released";
    payment.releasedAt = now;
  }

  /**
   * Releases all `authorized` payments whose `expires_at` has passed (worker job, SPEC.md section 4.8).
   *
   * @param now - Current timestamp
   * @returns Number of expired holds released
   *
   * @example
   * ```ts
   * const count = await facilitator.releaseExpiredPayments();
   * ```
   */
  async releaseExpiredPayments(now: Date = new Date()): Promise<number> {
    return this.mutex.runExclusive(() => {
      let releasedCount = 0;
      for (const payment of this.paymentsById.values()) {
        if (payment.status === "authorized" && payment.expiresAt.getTime() <= now.getTime()) {
          this.releasePaymentInternal(payment, now);
          releasedCount++;
        }
      }
      return releasedCount;
    });
  }

  /**
   * Reads a payment (`GET /v1/payments/{id}`, SPEC.md sections 5.1 and 8.4).
   *
   * - If called with an Agent key: verifies wallet ownership (`404` otherwise).
   * - If called with a Seller key: verifies seller ownership (`404` otherwise) and returns a pseudonymous `agent_ref`, never buyer identity.
   */
  async getPaymentForCaller(params: {
    rawBearerKey: string | undefined;
    paymentId: string;
    now?: Date | undefined;
  }): Promise<Record<string, unknown>> {
    const now = params.now ?? new Date();
    if (!params.rawBearerKey) {
      throw new HagglesError("Missing API key.", { code: "unauthorized", status: 401 });
    }
    const parsed = parseApiKey(params.rawBearerKey);
    if (!parsed) {
      throw new HagglesError("Malformed API key.", { code: "unauthorized", status: 401 });
    }

    if (parsed.kind === "hgk") {
      const agentKey = this.authenticateAgentKey(params.rawBearerKey, now);
      const payment = this.paymentsById.get(params.paymentId);
      if (!payment || payment.walletId !== agentKey.walletId) {
        throw new HagglesError("Payment not found.", { code: "not_found", status: 404 });
      }
      return {
        payment_id: payment.id,
        status: payment.status,
        amount: formatMoney(payment.amountMicros),
        currency: "USD",
        method: payment.method,
        url: payment.url,
        seller_id: payment.sellerId,
        challenge_id: payment.challengeId,
        authorized_at: payment.authorizedAt.toISOString(),
        expires_at: payment.expiresAt.toISOString(),
        captured_at: payment.capturedAt ? payment.capturedAt.toISOString() : null,
        released_at: payment.releasedAt ? payment.releasedAt.toISOString() : null,
        refunded_at: payment.refundedAt ? payment.refundedAt.toISOString() : null,
        receipt: payment.receipt,
      };
    }

    const sellerKey = this.authenticateSellerKey(params.rawBearerKey, now);
    const payment = this.paymentsById.get(params.paymentId);
    if (!payment || payment.sellerId !== sellerKey.sellerId) {
      throw new HagglesError("Payment not found.", { code: "not_found", status: 404 });
    }
    const sellerNet = payment.amountMicros - payment.feeMicros;
    return {
      payment_id: payment.id,
      status: payment.status,
      amount: formatMoney(payment.amountMicros),
      fee: formatMoney(payment.feeMicros),
      seller_net: formatMoney(sellerNet),
      currency: "USD",
      method: payment.method,
      url: payment.url,
      seller_id: payment.sellerId,
      agent_ref: computeAgentRef(payment.agentKeyId, this.config.KEY_PEPPER),
      challenge_id: payment.challengeId,
      authorized_at: payment.authorizedAt.toISOString(),
      expires_at: payment.expiresAt.toISOString(),
      captured_at: payment.capturedAt ? payment.capturedAt.toISOString() : null,
      released_at: payment.releasedAt ? payment.releasedAt.toISOString() : null,
      refunded_at: payment.refundedAt ? payment.refundedAt.toISOString() : null,
    };
  }

  /**
   * Returns wallet balance and remaining policy allowance for an agent key (`GET /v1/wallet`, SPEC.md sections 5.1 and 10.2).
   */
  async getWalletForAgent(params: {
    rawAgentKey: string | undefined;
    now?: Date | undefined;
  }): Promise<{
    available: string;
    held: string;
    currency: "USD";
    allowance: {
      per_call_max: string;
      daily_remaining: string;
      monthly_remaining: string | null;
    };
  }> {
    const now = params.now ?? new Date();
    const agentKey = this.authenticateAgentKey(params.rawAgentKey, now);
    const avail = this.ledger.getBalance(walletAvailAccountId(agentKey.walletId));
    const held = this.ledger.getBalance(walletHeldAccountId(agentKey.walletId));
    const { dayStart, monthStart } = getUtcSpendPeriods(now);
    const daySpent = this.getSpentMicros(agentKey.id, "day", dayStart);
    const monthSpent = this.getSpentMicros(agentKey.id, "month", monthStart);

    const dailyRemaining =
      agentKey.dailyMaxMicros > daySpent ? agentKey.dailyMaxMicros - daySpent : 0n;
    const monthlyRemaining =
      agentKey.monthlyMaxMicros !== null
        ? agentKey.monthlyMaxMicros > monthSpent
          ? agentKey.monthlyMaxMicros - monthSpent
          : 0n
        : null;

    return {
      available: formatMoney(avail),
      held: formatMoney(held),
      currency: "USD",
      allowance: {
        per_call_max: formatMoney(agentKey.perCallMaxMicros),
        daily_remaining: formatMoney(dailyRemaining),
        monthly_remaining: monthlyRemaining !== null ? formatMoney(monthlyRemaining) : null,
      },
    };
  }

  /**
   * Executes payout ledger transitions (`PAYOUT_START`, `PAYOUT_DONE`, `PAYOUT_FEE`, `PAYOUT_FAIL`, `PAYOUT_REVERSED`, SPEC.md section 6.3 and 7.2).
   */
  postSellerPayoutStart(sellerId: string, payoutId: string, amountMicros: bigint): void {
    this.ledger.post(buildPayoutStartPostingPlan(sellerId, payoutId, amountMicros));
  }

  /**
   * Marks an in-flight payout as completed in the ledger and optionally records the PayPal payout fee.
   */
  postSellerPayoutDone(
    sellerId: string,
    payoutId: string,
    amountMicros: bigint,
    paypalFeeMicros: bigint = 0n,
  ): void {
    this.ledger.post(buildPayoutDonePostingPlan(sellerId, payoutId, amountMicros));
    if (paypalFeeMicros > 0n) {
      this.ledger.post(buildPayoutFeePostingPlan(payoutId, paypalFeeMicros));
    }
  }

  /**
   * Returns an in-flight payout back to `S_PENDING` when a payout fails.
   */
  postSellerPayoutFail(sellerId: string, payoutId: string, amountMicros: bigint): void {
    this.ledger.post(buildPayoutFailPostingPlan(sellerId, payoutId, amountMicros));
  }

  /**
   * Reverses a previously succeeded payout back to `S_PENDING` and `G_PAYPAL`.
   */
  postSellerPayoutReversed(sellerId: string, payoutId: string, amountMicros: bigint): void {
    this.ledger.post(buildPayoutReversedPostingPlan(sellerId, payoutId, amountMicros));
  }

  /**
   * Verifies all ledger invariants across all accounts, transactions, and entries (SPEC.md section 8.5).
   */
  verifyLedgerInvariants(): LedgerInvariantReport {
    return this.ledger.verifyInvariants();
  }

  /**
   * Returns all auto-discovered endpoints for a seller (`SPEC.md` section 2.1 D7).
   */
  getSellerEndpoints(sellerId: string): EndpointRecord[] {
    return Array.from(this.endpointsById.values()).filter((ep) => ep.sellerId === sellerId);
  }
}
