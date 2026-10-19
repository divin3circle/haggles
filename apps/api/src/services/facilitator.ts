/**
 * Core facilitator payment, policy, wallet, PayPal top-up/payout/webhook, OIDC session,
 * and portal service.
 *
 * Implements SPEC.md sections 4, 5.1, 5.2, 5.3, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 8.1, 8.3, 8.4, and 8.5.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type Challenge,
  ChallengeSchema,
  canonicalizeUrl,
  computePlatformFeeMicros,
  createId,
  floorToCentsMicros,
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
  MockPayPalGateway,
  type PayPalGateway,
  SandboxPayPalGateway,
} from "../paypal/gateway.js";
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
const SESSION_SLIDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PAYOUT_RATE_LIMIT_MS = 60 * 60 * 1000;

/**
 * Stored user account record (`accounts` table, SPEC.md section 6.1).
 *
 * @example
 * ```ts
 * console.log(account.paypalPayerId);
 * ```
 */
export interface AccountRecord {
  id: string;
  paypalPayerId: string;
  paypalUserId: string;
  email: string;
  paypalVerifiedAccount: boolean;
  displayName: string | null;
  isBuyer: boolean;
  isSeller: boolean;
  status: "active" | "frozen";
  createdAt: Date;
}

/**
 * Stored portal login session (`sessions` table, SPEC.md sections 6.1 and 8.3).
 *
 * @example
 * ```ts
 * console.log(session.accountId);
 * ```
 */
export interface SessionRecord {
  id: string;
  accountId: string;
  tokenHash: string;
  csrfToken: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
}

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
 * Stored wallet top-up record (`topups` table, SPEC.md sections 6.1 and 7.1).
 *
 * @example
 * ```ts
 * console.log(topup.status); // "credited"
 * ```
 */
export interface TopupRecord {
  id: string;
  walletId: string;
  amountMicros: bigint;
  paypalOrderId: string;
  paypalCaptureId: string | null;
  paypalFeeMicros: bigint | null;
  paypalNetMicros: bigint | null;
  status: "created" | "pending" | "credited" | "failed" | "reversed";
  createdAt: Date;
}

/**
 * Stored seller payout record (`payouts` table, SPEC.md sections 6.1 and 7.2).
 *
 * @example
 * ```ts
 * console.log(payout.status); // "succeeded"
 * ```
 */
export interface PayoutRecord {
  id: string;
  sellerId: string;
  amountMicros: bigint;
  batchRef: string;
  paypalBatchId: string | null;
  paypalItemId: string | null;
  paypalFeeMicros: bigint | null;
  status: "pending" | "processing" | "succeeded" | "failed" | "reversed";
  mode: "paypal" | "simulated";
  failureReason: string | null;
  requestedBy: "schedule" | "seller";
  createdAt: Date;
}

/**
 * Stored audit log record (`audit_log` table, SPEC.md section 6.1).
 *
 * @example
 * ```ts
 * console.log(audit.action); // "topup.reversed"
 * ```
 */
export interface AuditLogRecord {
  id: string;
  accountId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  ip: string | null;
  meta: Record<string, unknown>;
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

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
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
 * Transactional facilitator engine implementing SPEC.md sections 4, 5.1, 5.2, 5.3, 6.2, 6.3, 7, and 8.
 *
 * @example
 * ```ts
 * const facilitator = await FacilitatorService.create(config);
 * ```
 */
export class FacilitatorService {
  readonly config: ApiConfig;
  readonly ledger: InMemoryLedger;
  readonly paypal: PayPalGateway;
  private readonly mutex = new AsyncMutex();

  private readonly accountsById = new Map<string, AccountRecord>();
  private readonly accountsByPayerId = new Map<string, AccountRecord>();
  private readonly sessionsByTokenHash = new Map<string, SessionRecord>();
  private readonly wallets = new Map<string, WalletRecord>();
  private readonly walletsByAccountId = new Map<string, WalletRecord>();
  private readonly agentKeysById = new Map<string, AgentKeyRecord>();
  private readonly agentKeysByPrefix = new Map<string, AgentKeyRecord>();
  private readonly sellers = new Map<string, SellerRecord>();
  private readonly sellersByAccountId = new Map<string, SellerRecord>();
  private readonly sellerKeysById = new Map<string, SellerKeyRecord>();
  private readonly sellerKeysByPrefix = new Map<string, SellerKeyRecord>();
  private readonly endpointsById = new Map<string, EndpointRecord>();
  private readonly endpointsByComposite = new Map<string, EndpointRecord>();
  private readonly paymentsById = new Map<string, PaymentRecord>();
  private readonly paymentsByAgentIdempotency = new Map<string, PaymentRecord>();
  private readonly topupsById = new Map<string, TopupRecord>();
  private readonly topupsByOrderId = new Map<string, TopupRecord>();
  private readonly topupsByCaptureId = new Map<string, TopupRecord>();
  private readonly payoutsById = new Map<string, PayoutRecord>();
  private readonly webhookEvents = new Map<string, { eventId: string; eventType: string; processedAt: Date }>();
  private readonly auditLogs: AuditLogRecord[] = [];
  private readonly spendCounters = new Map<string, bigint>();
  private readonly signingKeys = new Map<string, SigningKeyRecord>();

  private constructor(config: ApiConfig, paypal?: PayPalGateway) {
    this.config = config;
    this.ledger = new InMemoryLedger();
    this.paypal =
      paypal ??
      (config.PAYPAL_MODE === "sandbox"
        ? new SandboxPayPalGateway(config)
        : new MockPayPalGateway());
  }

  /**
   * Creates a {@link FacilitatorService} and initializes an active Ed25519 signing key.
   *
   * @param config - Validated API configuration
   * @param paypal - Optional custom {@link PayPalGateway} instance
   * @returns Initialized {@link FacilitatorService}
   *
   * @example
   * ```ts
   * const service = await FacilitatorService.create(loadConfig());
   * ```
   */
  static async create(config: ApiConfig, paypal?: PayPalGateway): Promise<FacilitatorService> {
    const svc = new FacilitatorService(config, paypal);
    const keyRecord = await generateSigningKeyRecord(config.MASTER_KEY);
    svc.signingKeys.set(keyRecord.kid, keyRecord);
    return svc;
  }

  /**
   * Records an immutable security audit log entry (never stores secrets, SPEC.md sections 6.1 and 8.7).
   */
  recordAudit(params: {
    accountId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    ip?: string | null | undefined;
    meta?: Record<string, unknown> | undefined;
  }): AuditLogRecord {
    const entry: AuditLogRecord = {
      id: `aud_${createId("ltx").slice(4)}`,
      accountId: params.accountId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      ip: params.ip ?? null,
      meta: params.meta ?? {},
      createdAt: new Date(),
    };
    this.auditLogs.push(entry);
    return entry;
  }

  /**
   * Returns all recorded audit log entries.
   */
  getAuditLogs(): ReadonlyArray<AuditLogRecord> {
    return this.auditLogs;
  }

  /**
   * Rotates the facilitator's active Ed25519 signing key: retires the current active key
   * (keeping it in JWKS for 24 hours) and promotes a newly generated key (SPEC.md section 4.6).
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

  // ---------------------------------------------------------------------------
  // OIDC Auth, Accounts & Sessions (SPEC.md sections 5.2, 6.1, 8.3)
  // ---------------------------------------------------------------------------

  /**
   * Builds the Log in with PayPal authorization URL (SPEC.md section 8.3).
   */
  buildPayPalAuthorizeUrl(state: string, redirectUri: string): string {
    return this.paypal.buildAuthorizeUrl({ state, redirectUri });
  }

  /**
   * Upserts a user account from PayPal OIDC userinfo and creates a fresh rotated session (`hg_session` + `hg_csrf`, SPEC.md section 8.3).
   */
  async loginWithPayPalCode(params: {
    code: string;
    redirectUri: string;
    userAgent?: string | null | undefined;
    ip?: string | null | undefined;
    now?: Date | undefined;
  }): Promise<{
    account: AccountRecord;
    sessionToken: string;
    csrfToken: string;
    isNewAccount: boolean;
  }> {
    const now = params.now ?? new Date();
    const identity = await this.paypal.exchangeCodeForUserInfo({
      code: params.code,
      redirectUri: params.redirectUri,
    });

    let account = this.accountsByPayerId.get(identity.paypalPayerId);
    let isNewAccount = false;
    if (!account) {
      isNewAccount = true;
      account = {
        id: createId("acc", now.getTime()),
        paypalPayerId: identity.paypalPayerId,
        paypalUserId: identity.paypalUserId,
        email: identity.email,
        paypalVerifiedAccount: identity.verifiedAccount,
        displayName: identity.displayName,
        isBuyer: false,
        isSeller: false,
        status: "active",
        createdAt: now,
      };
      this.accountsById.set(account.id, account);
      this.accountsByPayerId.set(account.paypalPayerId, account);
    } else {
      account.email = identity.email;
      account.paypalVerifiedAccount = identity.verifiedAccount;
      if (!account.displayName && identity.displayName) {
        account.displayName = identity.displayName;
      }
    }

    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const tokenHash = sha256Hex(sessionToken);

    const session: SessionRecord = {
      id: `ses_${createId("acc").slice(4)}`,
      accountId: account.id,
      tokenHash,
      csrfToken,
      expiresAt: new Date(now.getTime() + SESSION_SLIDING_TTL_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
      userAgent: params.userAgent ?? null,
      ip: params.ip ?? null,
      createdAt: now,
    };
    this.sessionsByTokenHash.set(tokenHash, session);

    this.recordAudit({
      accountId: account.id,
      action: "auth.login",
      targetType: "account",
      targetId: account.id,
      ip: params.ip,
    });

    return { account, sessionToken, csrfToken, isNewAccount };
  }

  /**
   * Authenticates a portal request using the `hg_session` cookie and (for state-changing requests)
   * verifies the double-submit `hg_csrf` cookie + `X-Haggles-CSRF` header and `Origin` header (SPEC.md section 8.3).
   */
  authenticateSession(params: {
    sessionToken: string | undefined;
    method: string;
    csrfCookie?: string | undefined;
    csrfHeader?: string | undefined;
    originHeader?: string | undefined;
    now?: Date | undefined;
  }): { account: AccountRecord; session: SessionRecord } {
    const now = params.now ?? new Date();
    if (!params.sessionToken) {
      throw new HagglesError("Authentication required.", { code: "unauthorized", status: 401 });
    }
    const tokenHash = sha256Hex(params.sessionToken);
    const session = this.sessionsByTokenHash.get(tokenHash);
    if (!session) {
      throw new HagglesError("Invalid or expired session.", { code: "unauthorized", status: 401 });
    }
    if (
      session.expiresAt.getTime() <= now.getTime() ||
      session.absoluteExpiresAt.getTime() <= now.getTime()
    ) {
      this.sessionsByTokenHash.delete(tokenHash);
      throw new HagglesError("Session has expired.", { code: "unauthorized", status: 401 });
    }

    const account = this.accountsById.get(session.accountId);
    if (!account || account.status === "frozen") {
      throw new HagglesError("Account is unavailable.", { code: "forbidden", status: 403 });
    }

    const isStateChanging = !["GET", "HEAD", "OPTIONS"].includes(params.method.toUpperCase());
    if (isStateChanging) {
      if (params.originHeader) {
        const expectedOrigin = new URL(this.config.PUBLIC_PORTAL_URL).origin;
        if (params.originHeader !== expectedOrigin) {
          throw new HagglesError("Origin header mismatch.", { code: "forbidden", status: 403 });
        }
      }
      if (!params.csrfCookie || !params.csrfHeader) {
        throw new HagglesError("Missing CSRF token.", { code: "forbidden", status: 403 });
      }
      const a = Buffer.from(params.csrfCookie, "utf8");
      const b = Buffer.from(params.csrfHeader, "utf8");
      const c = Buffer.from(session.csrfToken, "utf8");
      if (
        a.byteLength !== b.byteLength ||
        a.byteLength !== c.byteLength ||
        !timingSafeEqual(a, b) ||
        !timingSafeEqual(a, c)
      ) {
        throw new HagglesError("CSRF token mismatch.", { code: "forbidden", status: 403 });
      }
    }

    // Sliding 7-day window capped by 30-day absolute expiry (SPEC 8.3)
    const nextSliding = new Date(
      Math.min(
        now.getTime() + SESSION_SLIDING_TTL_MS,
        session.absoluteExpiresAt.getTime(),
      ),
    );
    session.expiresAt = nextSliding;

    return { account, session };
  }

  /**
   * Invalidates a single session token (`POST /portal/v1/auth/logout`, SPEC.md section 8.3).
   */
  logoutSession(sessionToken: string | undefined): void {
    if (!sessionToken) return;
    const tokenHash = sha256Hex(sessionToken);
    this.sessionsByTokenHash.delete(tokenHash);
  }

  /**
   * Invalidates all active sessions for an account ("Sign out all sessions", SPEC.md section 11.6).
   */
  revokeAllAccountSessions(accountId: string): number {
    let count = 0;
    for (const [hash, s] of this.sessionsByTokenHash.entries()) {
      if (s.accountId === accountId) {
        this.sessionsByTokenHash.delete(hash);
        count++;
      }
    }
    return count;
  }

  /**
   * Updates account profile and Buyer/Seller roles (`PATCH /portal/v1/me`, SPEC.md sections 5.2, 11.3, 11.6).
   *
   * Automatically provisions the buyer wallet and/or seller record when enabled.
   * Forbids disabling a role while its balance is non-zero (SPEC.md section 11.6).
   */
  updateAccountProfile(params: {
    accountId: string;
    displayName?: string | undefined;
    isBuyer?: boolean | undefined;
    isSeller?: boolean | undefined;
  }): {
    account: AccountRecord;
    wallet: WalletRecord | null;
    seller: SellerRecord | null;
  } {
    const account = this.accountsById.get(params.accountId);
    if (!account) {
      throw new HagglesError("Account not found.", { code: "not_found", status: 404 });
    }

    if (params.displayName !== undefined) {
      account.displayName = params.displayName.trim() || null;
    }

    if (params.isBuyer === false && account.isBuyer) {
      const wallet = this.walletsByAccountId.get(account.id);
      if (wallet) {
        const avail = this.ledger.getBalance(walletAvailAccountId(wallet.id));
        const held = this.ledger.getBalance(walletHeldAccountId(wallet.id));
        if (avail !== 0n || held !== 0n) {
          throw new HagglesError(
            "Cannot disable Buyer role while wallet has a non-zero balance.",
            { code: "forbidden", status: 403 },
          );
        }
      }
      account.isBuyer = false;
    } else if (params.isBuyer === true) {
      account.isBuyer = true;
      if (!this.walletsByAccountId.has(account.id)) {
        this.createWallet(account.id);
      }
    }

    if (params.isSeller === false && account.isSeller) {
      const seller = this.sellersByAccountId.get(account.id);
      if (seller) {
        const pending = this.ledger.getBalance(sellerPendingAccountId(seller.id));
        const payout = this.ledger.getBalance(sellerPayoutAccountId(seller.id));
        if (pending !== 0n || payout !== 0n) {
          throw new HagglesError(
            "Cannot disable Seller role while pending or processing balance is non-zero.",
            { code: "forbidden", status: 403 },
          );
        }
      }
      account.isSeller = false;
    } else if (params.isSeller === true) {
      account.isSeller = true;
      if (!this.sellersByAccountId.has(account.id)) {
        this.createSeller({
          accountId: account.id,
          payoutPaypalPayerId: account.paypalPayerId,
          payoutEmail: account.email,
        });
      }
    }

    return {
      account,
      wallet: this.walletsByAccountId.get(account.id) ?? null,
      seller: this.sellersByAccountId.get(account.id) ?? null,
    };
  }

  /**
   * Returns the wallet belonging to `accountId`, or throws `404` if not provisioned.
   */
  getWalletForAccount(accountId: string): WalletRecord {
    const wallet = this.walletsByAccountId.get(accountId);
    if (!wallet) {
      throw new HagglesError("Buyer wallet not enabled on this account.", {
        code: "not_found",
        status: 404,
      });
    }
    return wallet;
  }

  /**
   * Returns the seller profile belonging to `accountId`, or throws `404` if not provisioned.
   */
  getSellerForAccount(accountId: string): SellerRecord {
    const seller = this.sellersByAccountId.get(accountId);
    if (!seller) {
      throw new HagglesError("Seller profile not enabled on this account.", {
        code: "not_found",
        status: 404,
      });
    }
    return seller;
  }

  // ---------------------------------------------------------------------------
  // Wallets, Top-ups, Sellers, Payouts, Webhooks (SPEC.md section 7)
  // ---------------------------------------------------------------------------

  /**
   * Creates a buyer wallet and initializes its `W_AVAIL` and `W_HELD` ledger accounts.
   */
  createWallet(accountId: string, walletId: string = createId("wal")): WalletRecord {
    const existing = this.walletsByAccountId.get(accountId);
    if (existing) return existing;
    const record: WalletRecord = {
      id: walletId,
      accountId,
      status: "active",
      createdAt: new Date(),
    };
    this.wallets.set(record.id, record);
    this.walletsByAccountId.set(accountId, record);
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
   * Starts a PayPal Order top-up flow (`POST /portal/v1/buyer/topups`, SPEC.md section 7.1 step 1).
   */
  async createTopupOrder(params: {
    walletId: string;
    amountUsd: string;
    now?: Date | undefined;
  }): Promise<TopupRecord & { approveUrl: string }> {
    const now = params.now ?? new Date();
    const wallet = this.wallets.get(params.walletId);
    if (!wallet) {
      throw new HagglesError("Wallet not found.", { code: "not_found", status: 404 });
    }
    if (wallet.status === "frozen") {
      throw new HagglesError("Wallet is frozen.", { code: "wallet_frozen", status: 403 });
    }

    const amountMicros = parseMoney(params.amountUsd);
    if (
      amountMicros < this.config.TOPUP_MIN_MICROS ||
      amountMicros > this.config.TOPUP_MAX_MICROS
    ) {
      throw new HagglesError(
        `Top-up amount $${formatMoney(amountMicros)} is outside allowed limits ($${formatMoney(this.config.TOPUP_MIN_MICROS)}..$${formatMoney(this.config.TOPUP_MAX_MICROS)}).`,
        { code: "wallet_limit_exceeded", status: 409 },
      );
    }

    const avail = this.ledger.getBalance(walletAvailAccountId(wallet.id));
    const held = this.ledger.getBalance(walletHeldAccountId(wallet.id));
    if (avail + held + amountMicros > this.config.WALLET_MAX_MICROS) {
      throw new HagglesError(
        `Top-up of $${formatMoney(amountMicros)} would exceed the $${formatMoney(this.config.WALLET_MAX_MICROS)} maximum wallet balance.`,
        { code: "wallet_limit_exceeded", status: 409 },
      );
    }

    const topupId = createId("top", now.getTime());
    const { orderId, approveUrl } = await this.paypal.createOrder({
      topupId,
      amountMicros,
    });

    const record: TopupRecord = {
      id: topupId,
      walletId: wallet.id,
      amountMicros,
      paypalOrderId: orderId,
      paypalCaptureId: null,
      paypalFeeMicros: null,
      paypalNetMicros: null,
      status: "created",
      createdAt: now,
    };
    this.topupsById.set(record.id, record);
    this.topupsByOrderId.set(orderId, record);

    return { ...record, approveUrl };
  }

  /**
   * Captures an approved PayPal top-up order (`POST /portal/v1/buyer/topups/{id}/capture`, SPEC.md section 7.1 steps 3-4).
   *
   * Credits the wallet ONLY when PayPal reports capture `status === "COMPLETED"`.
   * If `status === "PENDING"`, marks the top-up `pending` and waits for the `PAYMENT.CAPTURE.COMPLETED` webhook.
   */
  async captureTopupOrder(params: {
    walletId: string;
    topupId: string;
  }): Promise<TopupRecord> {
    return this.mutex.runExclusive(async () => {
      const topup = this.topupsById.get(params.topupId);
      if (!topup || topup.walletId !== params.walletId) {
        throw new HagglesError("Top-up not found.", { code: "not_found", status: 404 });
      }
      if (topup.status === "credited") {
        return topup;
      }

      const capture = await this.paypal.captureOrder({
        topupId: topup.id,
        orderId: topup.paypalOrderId,
      });

      topup.paypalCaptureId = capture.captureId;
      topup.paypalFeeMicros = capture.feeMicros;
      topup.paypalNetMicros = capture.netMicros;
      this.topupsByCaptureId.set(capture.captureId, topup);

      if (capture.status === "COMPLETED") {
        // Use PayPal's verified gross and fee amounts (never trust client-supplied amounts, SPEC 8.5)
        topup.amountMicros = capture.grossMicros;
        this.ledger.post(
          buildTopupPostingPlan(
            topup.walletId,
            topup.id,
            capture.grossMicros,
            capture.feeMicros,
          ),
        );
        topup.status = "credited";
      } else if (capture.status === "PENDING") {
        topup.status = "pending";
      } else {
        topup.status = "failed";
      }

      return topup;
    });
  }

  /**
   * Lists top-ups for a wallet in reverse chronological order.
   */
  listWalletTopups(walletId: string): TopupRecord[] {
    return Array.from(this.topupsById.values())
      .filter((t) => t.walletId === walletId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Direct helper to credit a wallet top-up in tests or seeds (`TOPUP` ledger posting, SPEC.md sections 6.3 and 7.1).
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
    if (!this.topupsById.has(params.topupId)) {
      const topup: TopupRecord = {
        id: params.topupId,
        walletId: wallet.id,
        amountMicros: params.grossAmountMicros,
        paypalOrderId: `ORD_${params.topupId}`,
        paypalCaptureId: `CAP_${params.topupId}`,
        paypalFeeMicros: params.paypalFeeMicros,
        paypalNetMicros: params.grossAmountMicros - params.paypalFeeMicros,
        status: "credited",
        createdAt: new Date(),
      };
      this.topupsById.set(topup.id, topup);
      this.topupsByOrderId.set(topup.paypalOrderId, topup);
      this.topupsByCaptureId.set(topup.paypalCaptureId!, topup);
    }
    return {
      topupId: params.topupId,
      availableMicros: this.ledger.getBalance(availId),
      heldMicros: this.ledger.getBalance(heldId),
      idempotentReplay,
    };
  }

  /**
   * Creates a seller profile and initializes its `S_PENDING` and `S_PAYOUT` ledger accounts.
   */
  createSeller(params: {
    accountId: string;
    sellerId?: string | undefined;
    payoutPaypalPayerId: string;
    payoutEmail: string;
    payoutMode?: "paypal" | "simulated" | undefined;
    status?: "active" | "paused" | undefined;
  }): SellerRecord {
    const existing = this.sellersByAccountId.get(params.accountId);
    if (existing && !params.sellerId) return existing;
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
    this.sellersByAccountId.set(params.accountId, record);
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
   * Initiates a seller payout (`POST /portal/v1/seller/payouts` or scheduled job, SPEC.md section 7.2).
   *
   * - Requires `S_PENDING >= PAYOUT_MIN_MICROS`.
   * - Rounds down to whole cents (`floorToCentsMicros(S_PENDING)`), leaving sub-cent remainder in `S_PENDING`.
   * - For seller-initiated requests, enforces max 1 request per hour per seller.
   * - Persists `batch_ref = hgb_<ULID>` and posts `PAYOUT_START` before calling PayPal (crash recovery, SPEC 7.2 step 4).
   */
  async requestSellerPayout(params: {
    sellerId: string;
    requestedBy: "seller" | "schedule";
    batchRef?: string | undefined;
    now?: Date | undefined;
  }): Promise<PayoutRecord> {
    return this.mutex.runExclusive(async () => {
      const now = params.now ?? new Date();
      const seller = this.sellers.get(params.sellerId);
      if (!seller) {
        throw new HagglesError("Seller not found.", { code: "seller_not_found", status: 404 });
      }

      if (params.requestedBy === "seller") {
        for (const p of this.payoutsById.values()) {
          if (
            p.sellerId === seller.id &&
            p.requestedBy === "seller" &&
            now.getTime() - p.createdAt.getTime() < PAYOUT_RATE_LIMIT_MS
          ) {
            throw new HagglesError(
              "Only one on-demand payout may be requested per hour.",
              { code: "rate_limited", status: 429 },
            );
          }
        }
      }

      const pendingBalance = this.ledger.getBalance(sellerPendingAccountId(seller.id));
      const payoutAmount = floorToCentsMicros(pendingBalance > 0n ? pendingBalance : 0n);
      if (payoutAmount < this.config.PAYOUT_MIN_MICROS) {
        throw new InsufficientFundsError(
          `Pending balance $${formatMoney(pendingBalance > 0n ? pendingBalance : 0n)} is below the $${formatMoney(this.config.PAYOUT_MIN_MICROS)} payout minimum.`,
        );
      }

      const payoutId = createId("pot", now.getTime());
      const batchRef = params.batchRef ?? createId("hgb", now.getTime());

      const payout: PayoutRecord = {
        id: payoutId,
        sellerId: seller.id,
        amountMicros: payoutAmount,
        batchRef,
        paypalBatchId: null,
        paypalItemId: null,
        paypalFeeMicros: null,
        status: "pending",
        mode: seller.payoutMode,
        failureReason: null,
        requestedBy: params.requestedBy,
        createdAt: now,
      };
      this.payoutsById.set(payout.id, payout);
      this.ledger.post(buildPayoutStartPostingPlan(seller.id, payout.id, payoutAmount));

      if (seller.payoutMode === "simulated") {
        // SPEC 7.2 step 6: simulated payouts skip PayPal API and complete with 0 fee
        this.ledger.post(buildPayoutDonePostingPlan(seller.id, payout.id, payoutAmount));
        payout.status = "succeeded";
        payout.paypalFeeMicros = 0n;
        return payout;
      }

      const { paypalBatchId } = await this.paypal.createPayoutBatch({
        batchRef,
        items: [
          {
            payoutId: payout.id,
            receiverPayerId: seller.payoutPaypalPayerId,
            amountMicros: payoutAmount,
          },
        ],
      });
      payout.paypalBatchId = paypalBatchId;
      payout.status = "processing";
      return payout;
    });
  }

  /**
   * Polls PayPal for any `processing` payouts and reconciles their status (`GET /v1/payments/payouts/{batch_id}`, SPEC.md section 7.2 step 5).
   */
  async reconcileProcessingPayouts(): Promise<number> {
    return this.mutex.runExclusive(async () => {
      let updated = 0;
      const batchIds = new Set<string>();
      for (const p of this.payoutsById.values()) {
        if (p.status === "processing" && p.paypalBatchId) {
          batchIds.add(p.paypalBatchId);
        }
      }
      for (const batchId of batchIds) {
        const batch = await this.paypal.getPayoutBatch(batchId);
        if (batch.batchStatus === "DENIED") {
          for (const p of this.payoutsById.values()) {
            if (p.paypalBatchId === batchId && p.status === "processing") {
              this.ledger.post(buildPayoutFailPostingPlan(p.sellerId, p.id, p.amountMicros));
              p.status = "failed";
              p.failureReason = "BATCH_DENIED";
              updated++;
            }
          }
          continue;
        }
        for (const item of batch.items) {
          const payout = this.payoutsById.get(item.senderItemId);
          if (!payout || payout.status !== "processing") continue;
          payout.paypalItemId = item.payoutItemId;
          if (item.transactionStatus === "SUCCESS") {
            this.ledger.post(
              buildPayoutDonePostingPlan(payout.sellerId, payout.id, payout.amountMicros),
            );
            if (item.feeMicros && item.feeMicros > 0n) {
              this.ledger.post(buildPayoutFeePostingPlan(payout.id, item.feeMicros));
            }
            payout.paypalFeeMicros = item.feeMicros ?? 0n;
            payout.status = "succeeded";
            updated++;
          } else if (
            item.transactionStatus === "FAILED" ||
            item.transactionStatus === "DENIED" ||
            item.transactionStatus === "BLOCKED" ||
            item.transactionStatus === "CANCELED" ||
            item.transactionStatus === "RETURNED" ||
            item.transactionStatus === "REFUNDED"
          ) {
            this.ledger.post(
              buildPayoutFailPostingPlan(payout.sellerId, payout.id, payout.amountMicros),
            );
            payout.status = "failed";
            payout.failureReason = item.failureReason ?? item.transactionStatus;
            updated++;
          }
        }
      }
      return updated;
    });
  }

  /**
   * Lists payouts for a seller in reverse chronological order.
   */
  listSellerPayouts(sellerId: string): PayoutRecord[] {
    return Array.from(this.payoutsById.values())
      .filter((p) => p.sellerId === sellerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Verifies and processes an incoming PayPal webhook (`POST /webhooks/paypal`, SPEC.md sections 7.1, 7.2, 8.5).
   *
   * - Verifies signature via `paypal.verifyWebhookSignature`.
   * - Deduplicates by `paypal_event_id`.
   * - Never trusts webhook payload amounts: always re-fetches order or payout batch details from `PayPalGateway` before posting to the ledger.
   */
  async handlePayPalWebhook(params: {
    headers: Record<string, string | undefined>;
    rawBody: string;
    now?: Date | undefined;
  }): Promise<{ verified: true; duplicate: boolean; eventId: string; eventType: string }> {
    const now = params.now ?? new Date();
    const isValidSig = await this.paypal.verifyWebhookSignature({
      headers: params.headers,
      rawBody: params.rawBody,
    });
    if (!isValidSig) {
      throw new HagglesError("Invalid PayPal webhook signature.", {
        code: "unauthorized",
        status: 401,
      });
    }

    let event: {
      id?: string;
      event_type?: string;
      resource?: Record<string, unknown>;
    };
    try {
      event = JSON.parse(params.rawBody) as {
        id?: string;
        event_type?: string;
        resource?: Record<string, unknown>;
      };
    } catch (cause) {
      throw new InvalidChallengeError("Malformed PayPal webhook JSON payload.", { cause });
    }

    if (!event.id || !event.event_type) {
      throw new InvalidChallengeError("PayPal webhook missing id or event_type.");
    }

    return this.mutex.runExclusive(async () => {
      if (this.webhookEvents.has(event.id!)) {
        return {
          verified: true as const,
          duplicate: true,
          eventId: event.id!,
          eventType: event.event_type!,
        };
      }

      const eventType = event.event_type!;
      const resource = event.resource ?? {};

      // Extract order ID or capture ID for top-up events
      const suppData = resource.supplementary_data as
        | { related_ids?: { order_id?: string } }
        | undefined;
      const orderId =
        suppData?.related_ids?.order_id ??
        (typeof resource.order_id === "string" ? resource.order_id : undefined);
      const captureId = typeof resource.id === "string" ? resource.id : undefined;
      const customId = typeof resource.custom_id === "string" ? resource.custom_id : undefined;

      const resolveTopup = (): TopupRecord | undefined => {
        if (customId && this.topupsById.has(customId)) return this.topupsById.get(customId);
        if (orderId && this.topupsByOrderId.has(orderId)) return this.topupsByOrderId.get(orderId);
        if (captureId && this.topupsByCaptureId.has(captureId)) {
          return this.topupsByCaptureId.get(captureId);
        }
        return undefined;
      };

      if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
        const topup = resolveTopup();
        if (topup) {
          // Re-fetch from PayPal before crediting the ledger (SPEC 8.5)
          const fetched = await this.paypal.getOrder(topup.paypalOrderId);
          if (fetched.capture && fetched.capture.status === "COMPLETED") {
            topup.paypalCaptureId = fetched.capture.captureId;
            topup.paypalFeeMicros = fetched.capture.feeMicros;
            topup.paypalNetMicros = fetched.capture.netMicros;
            topup.amountMicros = fetched.capture.grossMicros;
            this.topupsByCaptureId.set(fetched.capture.captureId, topup);
            this.ledger.post(
              buildTopupPostingPlan(
                topup.walletId,
                topup.id,
                fetched.capture.grossMicros,
                fetched.capture.feeMicros,
              ),
            );
            topup.status = "credited";
          }
        }
      } else if (eventType === "PAYMENT.CAPTURE.DENIED") {
        const topup = resolveTopup();
        if (topup && topup.status !== "credited") {
          topup.status = "failed";
        }
      } else if (
        eventType === "PAYMENT.CAPTURE.REVERSED" ||
        eventType === "CHECKOUT.PAYMENT-APPROVAL.REVERSED"
      ) {
        const topup = resolveTopup();
        if (topup) {
          topup.status = "reversed";
          const wallet = this.wallets.get(topup.walletId);
          if (wallet) {
            wallet.status = "frozen";
            this.recordAudit({
              accountId: wallet.accountId,
              action: "topup.reversed",
              targetType: "wallet",
              targetId: wallet.id,
              meta: { topupId: topup.id, eventType },
            });
          }
        }
      } else if (eventType === "PAYMENT.PAYOUTSBATCH.DENIED") {
        const batchHeader = resource.batch_header as { payout_batch_id?: string } | undefined;
        const batchId = batchHeader?.payout_batch_id;
        if (batchId) {
          for (const p of this.payoutsById.values()) {
            if (p.paypalBatchId === batchId && p.status === "processing") {
              this.ledger.post(buildPayoutFailPostingPlan(p.sellerId, p.id, p.amountMicros));
              p.status = "failed";
              p.failureReason = "BATCH_DENIED";
            }
          }
        }
      } else if (eventType.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
        const batchId =
          typeof resource.payout_batch_id === "string" ? resource.payout_batch_id : undefined;
        const payoutItem = resource.payout_item as { sender_item_id?: string } | undefined;
        const senderItemId =
          payoutItem?.sender_item_id ??
          (typeof resource.sender_item_id === "string" ? resource.sender_item_id : undefined);

        if (batchId && senderItemId) {
          const payout = this.payoutsById.get(senderItemId);
          if (payout) {
            // Re-fetch batch details from PayPal to confirm status and fee (SPEC 7.2 step 5 & 8.5)
            const batch = await this.paypal.getPayoutBatch(batchId);
            const item = batch.items.find((i) => i.senderItemId === senderItemId);
            if (item) {
              payout.paypalItemId = item.payoutItemId;
              if (
                eventType === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED" &&
                item.transactionStatus === "SUCCESS" &&
                payout.status === "processing"
              ) {
                this.ledger.post(
                  buildPayoutDonePostingPlan(payout.sellerId, payout.id, payout.amountMicros),
                );
                if (item.feeMicros && item.feeMicros > 0n) {
                  this.ledger.post(buildPayoutFeePostingPlan(payout.id, item.feeMicros));
                }
                payout.paypalFeeMicros = item.feeMicros ?? 0n;
                payout.status = "succeeded";
              } else if (
                eventType === "PAYMENT.PAYOUTS-ITEM.FAILED" ||
                eventType === "PAYMENT.PAYOUTS-ITEM.DENIED" ||
                eventType === "PAYMENT.PAYOUTS-ITEM.BLOCKED" ||
                eventType === "PAYMENT.PAYOUTS-ITEM.CANCELED"
              ) {
                if (payout.status === "processing") {
                  this.ledger.post(
                    buildPayoutFailPostingPlan(payout.sellerId, payout.id, payout.amountMicros),
                  );
                  payout.status = "failed";
                  payout.failureReason = item.failureReason ?? eventType;
                }
              } else if (
                eventType === "PAYMENT.PAYOUTS-ITEM.RETURNED" ||
                eventType === "PAYMENT.PAYOUTS-ITEM.REFUNDED"
              ) {
                if (payout.status === "processing") {
                  this.ledger.post(
                    buildPayoutFailPostingPlan(payout.sellerId, payout.id, payout.amountMicros),
                  );
                  payout.status = "failed";
                  payout.failureReason = eventType;
                } else if (payout.status === "succeeded") {
                  this.ledger.post(
                    buildPayoutReversedPostingPlan(
                      payout.sellerId,
                      payout.id,
                      payout.amountMicros,
                    ),
                  );
                  payout.status = "reversed";
                }
              }
            }
          }
        }
      }

      this.webhookEvents.set(event.id!, {
        eventId: event.id!,
        eventType,
        processedAt: now,
      });

      return {
        verified: true as const,
        duplicate: false,
        eventId: event.id!,
        eventType,
      };
    });
  }

  /**
   * Issues a new buyer agent key (`hgk_<env>_...`) with spending policy defaults (SPEC.md sections 5.3 and 8.1).
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
   * Lists all agent keys belonging to a buyer wallet.
   */
  listAgentKeysForWallet(walletId: string): AgentKeyRecord[] {
    return Array.from(this.agentKeysById.values())
      .filter((k) => k.walletId === walletId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Reads a single agent key scoped to a buyer wallet (`404` if foreign, SPEC.md section 8.4).
   */
  getAgentKeyForWallet(walletId: string, keyId: string): AgentKeyRecord {
    const key = this.agentKeysById.get(keyId);
    if (!key || key.walletId !== walletId) {
      throw new HagglesError("Agent key not found.", { code: "not_found", status: 404 });
    }
    return key;
  }

  /**
   * Updates an agent key's name and policy fields (`PATCH /portal/v1/buyer/keys/{id}`, SPEC.md section 5.2).
   */
  updateAgentKeyForWallet(
    walletId: string,
    keyId: string,
    updates: {
      name?: string | undefined;
      perCallMaxMicros?: bigint | undefined;
      dailyMaxMicros?: bigint | undefined;
      monthlyMaxMicros?: bigint | null | undefined;
      allowedSellers?: string[] | null | undefined;
      allowedHosts?: string[] | null | undefined;
      expiresAt?: Date | null | undefined;
    },
  ): AgentKeyRecord {
    const key = this.getAgentKeyForWallet(walletId, keyId);
    if (updates.name !== undefined) key.name = updates.name;
    if (updates.perCallMaxMicros !== undefined) key.perCallMaxMicros = updates.perCallMaxMicros;
    if (updates.dailyMaxMicros !== undefined) key.dailyMaxMicros = updates.dailyMaxMicros;
    if (updates.monthlyMaxMicros !== undefined) key.monthlyMaxMicros = updates.monthlyMaxMicros;
    if (updates.allowedSellers !== undefined) key.allowedSellers = updates.allowedSellers;
    if (updates.allowedHosts !== undefined) {
      key.allowedHosts = updates.allowedHosts
        ? updates.allowedHosts.map((h) => h.toLowerCase())
        : null;
    }
    if (updates.expiresAt !== undefined) key.expiresAt = updates.expiresAt;
    return key;
  }

  /**
   * Revokes an agent key immediately (SPEC.md section 8.8), verifying wallet ownership when `walletId` is provided.
   */
  revokeAgentKey(agentKeyId: string, now: Date = new Date(), walletId?: string): AgentKeyRecord {
    const key = this.agentKeysById.get(agentKeyId);
    if (!key || (walletId !== undefined && key.walletId !== walletId)) {
      throw new HagglesError("Agent key not found.", { code: "not_found", status: 404 });
    }
    key.status = "revoked";
    key.revokedAt = now;
    return key;
  }

  /**
   * Issues a new seller API key (`hgs_<env>_...`), enforcing the maximum of 2 active keys per seller (SPEC.md section 6.1).
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
   * Lists all seller keys belonging to a seller.
   */
  listSellerKeys(sellerId: string): SellerKeyRecord[] {
    return Array.from(this.sellerKeysById.values())
      .filter((k) => k.sellerId === sellerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Revokes a seller key immediately, verifying seller ownership when `sellerId` is provided.
   */
  revokeSellerKey(sellerKeyId: string, now: Date = new Date(), sellerId?: string): SellerKeyRecord {
    const key = this.sellerKeysById.get(sellerKeyId);
    if (!key || (sellerId !== undefined && key.sellerId !== sellerId)) {
      throw new HagglesError("Seller key not found.", { code: "not_found", status: 404 });
    }
    key.status = "revoked";
    key.revokedAt = now;
    return key;
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

  /**
   * Returns current spent micro-dollars for an agent key and UTC period.
   */
  getSpentMicros(agentKeyId: string, kind: "day" | "month", periodStart: string): bigint {
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

      const paymentId = createId("pay", now.getTime());
      const availBalance = this.ledger.getBalance(walletAvailAccountId(wallet.id));
      if (availBalance < amountMicros) {
        throw new InsufficientFundsError(
          `Available balance ${formatMoney(availBalance)} is less than ${formatMoney(amountMicros)}.`,
        );
      }

      this.ledger.post(buildHoldPostingPlan(wallet.id, paymentId, amountMicros));

      this.spendCounters.set(dayCounterKey, currentDaySpent + amountMicros);
      this.spendCounters.set(monthCounterKey, currentMonthSpent + amountMicros);

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

      const { claims } = await verifyPaymentTokenJws(params.token, this.getJwks(now).keys);
      if (claims.sub !== payment.id || claims.aud !== sellerKey.sellerId) {
        throw new HagglesError("Payment token subject or audience does not match.", {
          code: "request_mismatch",
          status: 409,
        });
      }

      const nowSec = Math.floor(now.getTime() / 1000);
      if (claims.exp <= nowSec || payment.expiresAt.getTime() <= now.getTime()) {
        this.releasePaymentInternal(payment, now);
        throw new HagglesError("Payment token or hold has expired.", {
          code: "token_expired",
          status: 410,
        });
      }

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

  // ---------------------------------------------------------------------------
  // Portal Queries for Buyer & Seller Dashboards (SPEC.md sections 5.2 and 11)
  // ---------------------------------------------------------------------------

  /**
   * Lists payments for a buyer wallet in reverse chronological order.
   */
  listBuyerPayments(walletId: string): Array<PaymentRecord & { keyName: string }> {
    return Array.from(this.paymentsById.values())
      .filter((p) => p.walletId === walletId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((p) => ({
        ...p,
        keyName: this.agentKeysById.get(p.agentKeyId)?.name ?? p.agentKeyId,
      }));
  }

  /**
   * Reads a single buyer payment scoped to `walletId` (`404` if foreign, SPEC.md section 8.4).
   */
  getBuyerPayment(walletId: string, paymentId: string): PaymentRecord & { keyName: string } {
    const p = this.paymentsById.get(paymentId);
    if (!p || p.walletId !== walletId) {
      throw new HagglesError("Payment not found.", { code: "not_found", status: 404 });
    }
    return {
      ...p,
      keyName: this.agentKeysById.get(p.agentKeyId)?.name ?? p.agentKeyId,
    };
  }

  /**
   * Lists calls (payments) for a seller in reverse chronological order with pseudonymous `agent_ref`.
   */
  listSellerCalls(sellerId: string): Array<PaymentRecord & { agentRef: string; route: string }> {
    return Array.from(this.paymentsById.values())
      .filter((p) => p.sellerId === sellerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((p) => ({
        ...p,
        agentRef: computeAgentRef(p.agentKeyId, this.config.KEY_PEPPER),
        route: p.endpointId
          ? (this.endpointsById.get(p.endpointId)?.route ?? new URL(p.url).pathname)
          : new URL(p.url).pathname,
      }));
  }

  /**
   * Updates an endpoint's display name, description, or status scoped to `sellerId` (`404` if foreign, SPEC.md section 8.4).
   */
  updateSellerEndpoint(
    sellerId: string,
    endpointId: string,
    updates: {
      displayName?: string | null | undefined;
      description?: string | null | undefined;
      status?: "active" | "hidden" | undefined;
    },
  ): EndpointRecord {
    const ep = this.endpointsById.get(endpointId);
    if (!ep || ep.sellerId !== sellerId) {
      throw new HagglesError("Endpoint not found.", { code: "not_found", status: 404 });
    }
    if (updates.displayName !== undefined) ep.displayName = updates.displayName;
    if (updates.description !== undefined) ep.description = updates.description;
    if (updates.status !== undefined) ep.status = updates.status;
    return ep;
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

  /**
   * Lists endpoints for a seller with 30-day call count and revenue metrics (`GET /portal/v1/seller/endpoints`, SPEC.md section 11.5).
   */
  listSellerEndpointsWithStats(
    sellerId: string,
    now: Date = new Date(),
  ): Array<{
    id: string;
    seller_id: string;
    method: string;
    route: string;
    display_name: string | null;
    description: string | null;
    last_price: string;
    calls_30d: number;
    revenue_30d: string;
    status: "active" | "hidden";
    created_at: string;
  }> {
    const cutoffMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const endpoints = this.getSellerEndpoints(sellerId);
    const payments = Array.from(this.paymentsById.values()).filter(
      (p) => p.sellerId === sellerId && p.status === "captured" && p.createdAt.getTime() >= cutoffMs,
    );

    return endpoints.map((ep) => {
      let calls30d = 0;
      let revMicros = 0n;
      for (const p of payments) {
        if (p.endpointId === ep.id) {
          calls30d++;
          revMicros += p.amountMicros - p.feeMicros;
        }
      }
      return {
        id: ep.id,
        seller_id: ep.sellerId,
        method: ep.method,
        route: ep.route,
        display_name: ep.displayName,
        description: ep.description,
        last_price: formatMoney(ep.lastPriceMicros),
        calls_30d: calls30d,
        revenue_30d: formatMoney(revMicros),
        status: ep.status,
        created_at: ep.createdAt.toISOString(),
      };
    });
  }

  /**
   * Computes the Buyer Overview summary (`GET /portal/v1/buyer/summary`, SPEC.md section 11.4).
   */
  getBuyerSummary(accountId: string, now: Date = new Date()): {
    wallet_id: string;
    status: "active" | "frozen";
    available: string;
    held: string;
    in_flight_count: number;
    spent_today: string;
    smallest_daily_max: string | null;
    spent_30d: string;
    recent_payments: Array<{
      payment_id: string;
      status: string;
      amount: string;
      method: string;
      url: string;
      seller_id: string;
      agent_key_id: string;
      key_name: string;
      created_at: string;
    }>;
  } {
    const wallet = this.getWalletForAccount(accountId);
    const avail = this.ledger.getBalance(walletAvailAccountId(wallet.id));
    const held = this.ledger.getBalance(walletHeldAccountId(wallet.id));
    const { dayStart } = getUtcSpendPeriods(now);
    const cutoff30d = now.getTime() - 30 * 24 * 60 * 60 * 1000;

    const activeKeys = this.listAgentKeysForWallet(wallet.id).filter(
      (k) => k.status === "active",
    );
    let smallestDailyMax: bigint | null = null;
    for (const k of activeKeys) {
      if (smallestDailyMax === null || k.dailyMaxMicros < smallestDailyMax) {
        smallestDailyMax = k.dailyMaxMicros;
      }
    }

    let inFlightCount = 0;
    let spentTodayMicros = 0n;
    let spent30dMicros = 0n;

    const allPayments = this.listBuyerPayments(wallet.id);
    for (const p of allPayments) {
      if (p.status === "authorized") {
        inFlightCount++;
      }
      if (p.status === "authorized" || p.status === "captured") {
        const pDay = getUtcSpendPeriods(p.authorizedAt).dayStart;
        if (pDay === dayStart) {
          spentTodayMicros += p.amountMicros;
        }
        if (p.authorizedAt.getTime() >= cutoff30d) {
          spent30dMicros += p.amountMicros;
        }
      }
    }

    return {
      wallet_id: wallet.id,
      status: wallet.status,
      available: formatMoney(avail),
      held: formatMoney(held),
      in_flight_count: inFlightCount,
      spent_today: formatMoney(spentTodayMicros),
      smallest_daily_max: smallestDailyMax !== null ? formatMoney(smallestDailyMax) : null,
      spent_30d: formatMoney(spent30dMicros),
      recent_payments: allPayments.slice(0, 10).map((p) => ({
        payment_id: p.id,
        status: p.status,
        amount: formatMoney(p.amountMicros),
        method: p.method,
        url: p.url,
        seller_id: p.sellerId,
        agent_key_id: p.agentKeyId,
        key_name: p.keyName,
        created_at: p.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Computes daily buyer spend time-series (`GET /portal/v1/buyer/spend-series`, SPEC.md section 11.4).
   */
  getBuyerSpendSeries(
    accountId: string,
    days: number = 30,
    now: Date = new Date(),
  ): Array<{ date: string; spent: string; count: number }> {
    const wallet = this.getWalletForAccount(accountId);
    const clampedDays = Math.min(Math.max(days, 1), 90);
    const payments = this.listBuyerPayments(wallet.id);

    const byDate = new Map<string, { micros: bigint; count: number }>();
    for (let i = clampedDays - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      byDate.set(dateStr, { micros: 0n, count: 0 });
    }

    for (const p of payments) {
      if (p.status !== "captured" && p.status !== "authorized") continue;
      const dateStr = p.authorizedAt.toISOString().slice(0, 10);
      const bucket = byDate.get(dateStr);
      if (bucket) {
        bucket.micros += p.amountMicros;
        bucket.count += 1;
      }
    }

    return Array.from(byDate.entries()).map(([date, val]) => ({
      date,
      spent: formatMoney(val.micros),
      count: val.count,
    }));
  }

  /**
   * Computes the Seller Overview summary (`GET /portal/v1/seller/summary`, SPEC.md section 11.5).
   */
  getSellerSummary(accountId: string, now: Date = new Date()): {
    seller_id: string;
    status: "active" | "paused";
    payout_email: string;
    payout_paypal_payer_id: string;
    payout_mode: "paypal" | "simulated";
    pending: string;
    processing: string;
    paid_out: string;
    calls_24h: number;
    revenue_30d: string;
    top_endpoints: Array<{
      id: string;
      method: string;
      route: string;
      display_name: string | null;
      calls_30d: number;
      revenue_30d: string;
    }>;
    recent_calls: Array<{
      payment_id: string;
      status: string;
      amount: string;
      fee: string;
      seller_net: string;
      method: string;
      route: string;
      url: string;
      agent_ref: string;
      created_at: string;
    }>;
  } {
    const seller = this.getSellerForAccount(accountId);
    const pendingBalance = this.ledger.getBalance(sellerPendingAccountId(seller.id));
    const processingBalance = this.ledger.getBalance(sellerPayoutAccountId(seller.id));

    let paidOutMicros = 0n;
    for (const p of this.listSellerPayouts(seller.id)) {
      if (p.status === "succeeded") {
        paidOutMicros += p.amountMicros;
      }
    }

    const cutoff24h = now.getTime() - 24 * 60 * 60 * 1000;
    const cutoff30d = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const allCalls = this.listSellerCalls(seller.id);

    let calls24h = 0;
    let rev30dMicros = 0n;
    for (const c of allCalls) {
      if (c.status === "captured") {
        if (c.createdAt.getTime() >= cutoff24h) {
          calls24h++;
        }
        if (c.createdAt.getTime() >= cutoff30d) {
          rev30dMicros += c.amountMicros - c.feeMicros;
        }
      }
    }

    const endpointsWithStats = this.listSellerEndpointsWithStats(seller.id, now)
      .sort((a, b) => Number(parseMoney(b.revenue_30d) - parseMoney(a.revenue_30d)))
      .slice(0, 5)
      .map((ep) => ({
        id: ep.id,
        method: ep.method,
        route: ep.route,
        display_name: ep.display_name,
        calls_30d: ep.calls_30d,
        revenue_30d: ep.revenue_30d,
      }));

    return {
      seller_id: seller.id,
      status: seller.status,
      payout_email: seller.payoutEmail,
      payout_paypal_payer_id: seller.payoutPaypalPayerId,
      payout_mode: seller.payoutMode,
      pending: formatMoney(pendingBalance >= 0n ? pendingBalance : 0n),
      processing: formatMoney(processingBalance),
      paid_out: formatMoney(paidOutMicros),
      calls_24h: calls24h,
      revenue_30d: formatMoney(rev30dMicros),
      top_endpoints: endpointsWithStats,
      recent_calls: allCalls.slice(0, 10).map((c) => ({
        payment_id: c.id,
        status: c.status,
        amount: formatMoney(c.amountMicros),
        fee: formatMoney(c.feeMicros),
        seller_net: formatMoney(c.amountMicros - c.feeMicros),
        method: c.method,
        route: c.route,
        url: c.url,
        agent_ref: c.agentRef,
        created_at: c.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Computes daily seller net revenue time-series (`GET /portal/v1/seller/revenue-series`, SPEC.md section 11.5).
   */
  getSellerRevenueSeries(
    accountId: string,
    days: number = 30,
    now: Date = new Date(),
  ): Array<{ date: string; revenue: string; calls: number }> {
    const seller = this.getSellerForAccount(accountId);
    const clampedDays = Math.min(Math.max(days, 1), 90);
    const calls = this.listSellerCalls(seller.id);

    const byDate = new Map<string, { micros: bigint; calls: number }>();
    for (let i = clampedDays - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      byDate.set(dateStr, { micros: 0n, calls: 0 });
    }

    for (const c of calls) {
      if (c.status !== "captured") continue;
      const dateStr = c.createdAt.toISOString().slice(0, 10);
      const bucket = byDate.get(dateStr);
      if (bucket) {
        bucket.micros += c.amountMicros - c.feeMicros;
        bucket.calls += 1;
      }
    }

    return Array.from(byDate.entries()).map(([date, val]) => ({
      date,
      revenue: formatMoney(val.micros),
      calls: val.calls,
    }));
  }

  /**
   * Issues a sandbox-only test agent key restricted to this seller (`POST /portal/v1/seller/test-key`, SPEC.md section 11.5 step 4).
   */
  issueSellerTestKey(accountId: string): { record: AgentKeyRecord; fullKey: string } {
    if (this.config.HAGGLES_ENV !== "test") {
      throw new HagglesError("Seller test keys are only available in test/sandbox mode.", {
        code: "forbidden",
        status: 403,
      });
    }
    const seller = this.getSellerForAccount(accountId);
    const sysWalletId = "wal_01J9Z3SYSTEMSANDBOXTEST000";
    if (!this.wallets.has(sysWalletId)) {
      this.createWallet("acc_01J9Z3SYSTEMSANDBOXTEST000", sysWalletId);
      this.creditWalletTopup({
        walletId: sysWalletId,
        topupId: "top_01J9Z3SYSTEMSANDBOXTEST000",
        grossAmountMicros: 50_000_000n,
        paypalFeeMicros: 0n,
      });
    }
    return this.createAgentKey({
      walletId: sysWalletId,
      name: `Sandbox test key for ${seller.id}`,
      perCallMaxMicros: 100_000n,
      dailyMaxMicros: 500_000n,
      allowedSellers: [seller.id],
    });
  }
}

