/**
 * PostgreSQL 16 database schema using Drizzle ORM (SPEC.md sections 6.1 and 6.2).
 *
 * All tables include `created_at timestamptz not null default now()`.
 * Money columns use `bigint` micro-dollars (`mode: "bigint"`).
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * User accounts authenticated via Log in with PayPal (SPEC.md sections 6.1 and 8.3).
 *
 * @example
 * ```ts
 * import { accounts } from "./schema.js";
 * ```
 */
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    paypalPayerId: text("paypal_payer_id").notNull().unique(),
    paypalUserId: text("paypal_user_id").notNull().unique(),
    email: text("email").notNull().unique(),
    paypalVerifiedAccount: boolean("paypal_verified_account").notNull().default(false),
    displayName: text("display_name"),
    isBuyer: boolean("is_buyer").notNull().default(false),
    isSeller: boolean("is_seller").notNull().default(false),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("accounts_status_check", sql`${t.status} IN ('active', 'frozen')`)],
);

/**
 * Portal login sessions with SHA-256 hashed session tokens (SPEC.md sections 6.1 and 8.3).
 *
 * @example
 * ```ts
 * import { sessions } from "./schema.js";
 * ```
 */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Buyer prepaid wallets (one per account, SPEC.md section 6.1).
 *
 * @example
 * ```ts
 * import { wallets } from "./schema.js";
 * ```
 */
export const wallets = pgTable(
  "wallets",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("wallets_status_check", sql`${t.status} IN ('active', 'frozen')`)],
);

/**
 * Buyer agent API keys (`hgk_<env>_...`) and their spending policies (SPEC.md sections 5.3, 6.1, 8.1).
 *
 * @example
 * ```ts
 * import { agentKeys } from "./schema.js";
 * ```
 */
export const agentKeys = pgTable(
  "agent_keys",
  {
    id: text("id").primaryKey(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull().unique(),
    keyHash: text("key_hash").notNull(),
    perCallMaxMicros: bigint("per_call_max_micros", { mode: "bigint" })
      .notNull()
      .default(100_000n),
    dailyMaxMicros: bigint("daily_max_micros", { mode: "bigint" })
      .notNull()
      .default(5_000_000n),
    monthlyMaxMicros: bigint("monthly_max_micros", { mode: "bigint" }),
    allowedSellers: text("allowed_sellers").array(),
    allowedHosts: text("allowed_hosts").array(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("agent_keys_status_check", sql`${t.status} IN ('active', 'revoked')`),
    check("agent_keys_per_call_max_nonneg", sql`${t.perCallMaxMicros} >= 0`),
    check("agent_keys_daily_max_nonneg", sql`${t.dailyMaxMicros} >= 0`),
    check(
      "agent_keys_monthly_max_nonneg",
      sql`${t.monthlyMaxMicros} IS NULL OR ${t.monthlyMaxMicros} >= 0`,
    ),
  ],
);

/**
 * Atomic per-key UTC daily and monthly spend counters (SPEC.md sections 5.3 and 6.1).
 *
 * @example
 * ```ts
 * import { agentKeySpend } from "./schema.js";
 * ```
 */
export const agentKeySpend = pgTable(
  "agent_key_spend",
  {
    agentKeyId: text("agent_key_id")
      .notNull()
      .references(() => agentKeys.id, { onDelete: "cascade" }),
    periodKind: text("period_kind").notNull(),
    periodStart: date("period_start").notNull(),
    spentMicros: bigint("spent_micros", { mode: "bigint" }).notNull().default(0n),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentKeyId, t.periodKind, t.periodStart] }),
    check("agent_key_spend_period_kind_check", sql`${t.periodKind} IN ('day', 'month')`),
    check("agent_key_spend_nonneg", sql`${t.spentMicros} >= 0`),
  ],
);

/**
 * Seller profiles and PayPal payout destinations (SPEC.md sections 6.1 and 7.2).
 *
 * @example
 * ```ts
 * import { sellers } from "./schema.js";
 * ```
 */
export const sellers = pgTable(
  "sellers",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"),
    payoutPaypalPayerId: text("payout_paypal_payer_id").notNull(),
    payoutEmail: text("payout_email").notNull(),
    payoutMode: text("payout_mode").notNull().default("paypal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("sellers_status_check", sql`${t.status} IN ('active', 'paused')`),
    check("sellers_payout_mode_check", sql`${t.payoutMode} IN ('paypal', 'simulated')`),
  ],
);

/**
 * Seller API keys (`hgs_<env>_...`, max 2 active per seller, SPEC.md sections 6.1 and 8.1).
 *
 * @example
 * ```ts
 * import { sellerKeys } from "./schema.js";
 * ```
 */
export const sellerKeys = pgTable(
  "seller_keys",
  {
    id: text("id").primaryKey(),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull().unique(),
    keyHash: text("key_hash").notNull(),
    status: text("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("seller_keys_status_check", sql`${t.status} IN ('active', 'revoked')`)],
);

/**
 * Seller HTTP endpoints automatically discovered on payment capture (SPEC.md sections 2.1 D7 and 6.1).
 *
 * @example
 * ```ts
 * import { endpoints } from "./schema.js";
 * ```
 */
export const endpoints = pgTable(
  "endpoints",
  {
    id: text("id").primaryKey(),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    method: text("method").notNull(),
    route: text("route").notNull(),
    displayName: text("display_name"),
    description: text("description"),
    lastPriceMicros: bigint("last_price_micros", { mode: "bigint" }).notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("endpoints_seller_method_route_uq").on(t.sellerId, t.method, t.route),
    check("endpoints_last_price_nonneg", sql`${t.lastPriceMicros} >= 0`),
    check("endpoints_status_check", sql`${t.status} IN ('active', 'hidden')`),
  ],
);

/**
 * Protocol payments and their lifecycle state machine (SPEC.md sections 4.8, 5.1, and 6.1).
 *
 * @example
 * ```ts
 * import { payments } from "./schema.js";
 * ```
 */
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "restrict" }),
    agentKeyId: text("agent_key_id")
      .notNull()
      .references(() => agentKeys.id, { onDelete: "restrict" }),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    endpointId: text("endpoint_id").references(() => endpoints.id, { onDelete: "set null" }),
    amountMicros: bigint("amount_micros", { mode: "bigint" }).notNull(),
    feeMicros: bigint("fee_micros", { mode: "bigint" }).notNull().default(0n),
    method: text("method").notNull(),
    url: text("url").notNull(),
    challengeId: text("challenge_id").notNull(),
    status: text("status").notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    redeemIdempotencyKey: text("redeem_idempotency_key"),
    responseStatus: integer("response_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_agent_key_idempotency_uq").on(t.agentKeyId, t.idempotencyKey),
    index("payments_seller_created_idx").on(t.sellerId, t.createdAt),
    index("payments_wallet_created_idx").on(t.walletId, t.createdAt),
    index("payments_authorized_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'authorized'`),
    check("payments_amount_nonneg", sql`${t.amountMicros} >= 0`),
    check("payments_fee_nonneg", sql`${t.feeMicros} >= 0`),
    check(
      "payments_status_check",
      sql`${t.status} IN ('authorized', 'captured', 'released', 'refunded')`,
    ),
  ],
);

/**
 * Buyer wallet top-ups via PayPal Orders v2 (SPEC.md sections 6.1 and 7.1).
 *
 * @example
 * ```ts
 * import { topups } from "./schema.js";
 * ```
 */
export const topups = pgTable(
  "topups",
  {
    id: text("id").primaryKey(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "restrict" }),
    amountMicros: bigint("amount_micros", { mode: "bigint" }).notNull(),
    paypalOrderId: text("paypal_order_id").notNull().unique(),
    paypalCaptureId: text("paypal_capture_id").unique(),
    paypalFeeMicros: bigint("paypal_fee_micros", { mode: "bigint" }),
    paypalNetMicros: bigint("paypal_net_micros", { mode: "bigint" }),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("topups_amount_nonneg", sql`${t.amountMicros} >= 0`),
    check("topups_fee_nonneg", sql`${t.paypalFeeMicros} IS NULL OR ${t.paypalFeeMicros} >= 0`),
    check("topups_net_nonneg", sql`${t.paypalNetMicros} IS NULL OR ${t.paypalNetMicros} >= 0`),
    check(
      "topups_status_check",
      sql`${t.status} IN ('created', 'pending', 'credited', 'failed', 'reversed')`,
    ),
  ],
);

/**
 * Seller earnings payouts via PayPal Payouts v1 or simulated mode (SPEC.md sections 6.1 and 7.2).
 *
 * @example
 * ```ts
 * import { payouts } from "./schema.js";
 * ```
 */
export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    amountMicros: bigint("amount_micros", { mode: "bigint" }).notNull(),
    batchRef: text("batch_ref").notNull(),
    paypalBatchId: text("paypal_batch_id"),
    paypalItemId: text("paypal_item_id"),
    paypalFeeMicros: bigint("paypal_fee_micros", { mode: "bigint" }),
    status: text("status").notNull(),
    mode: text("mode").notNull(),
    failureReason: text("failure_reason"),
    requestedBy: text("requested_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("payouts_amount_nonneg", sql`${t.amountMicros} >= 0`),
    check("payouts_fee_nonneg", sql`${t.paypalFeeMicros} IS NULL OR ${t.paypalFeeMicros} >= 0`),
    check(
      "payouts_status_check",
      sql`${t.status} IN ('pending', 'processing', 'succeeded', 'failed', 'reversed')`,
    ),
    check("payouts_mode_check", sql`${t.mode} IN ('paypal', 'simulated')`),
    check("payouts_requested_by_check", sql`${t.requestedBy} IN ('schedule', 'seller')`),
  ],
);

/**
 * Materialized double-entry ledger accounts (SPEC.md sections 6.1 and 6.2).
 *
 * Guarded accounts (`W_AVAIL`, `W_HELD`, `S_PAYOUT`) enforce `balance_micros >= 0` in Postgres.
 *
 * @example
 * ```ts
 * import { ledgerAccounts } from "./schema.js";
 * ```
 */
export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    ownerId: text("owner_id"),
    balanceMicros: bigint("balance_micros", { mode: "bigint" }).notNull().default(0n),
    version: bigint("version", { mode: "bigint" }).notNull().default(0n),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_accounts_kind_owner_uq").on(t.kind, t.ownerId),
    check(
      "ledger_accounts_kind_check",
      sql`${t.kind} IN ('W_AVAIL', 'W_HELD', 'S_PENDING', 'S_PAYOUT', 'G_PAYPAL', 'G_FEES', 'G_PAYPAL_FEES')`,
    ),
    check(
      "ledger_accounts_balance_guard_check",
      sql`(${t.kind} IN ('W_AVAIL', 'W_HELD', 'S_PAYOUT') AND ${t.balanceMicros} >= 0) OR ${t.kind} NOT IN ('W_AVAIL', 'W_HELD', 'S_PAYOUT')`,
    ),
  ],
);

/**
 * Double-entry ledger transactions, idempotent by `(reference_type, reference_id, kind)` (SPEC.md sections 6.1 and 6.3).
 *
 * @example
 * ```ts
 * import { ledgerTransactions } from "./schema.js";
 * ```
 */
export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    referenceType: text("reference_type").notNull(),
    referenceId: text("reference_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_transactions_ref_kind_uq").on(t.referenceType, t.referenceId, t.kind),
    check(
      "ledger_transactions_kind_check",
      sql`${t.kind} IN ('TOPUP', 'HOLD', 'RELEASE', 'CAPTURE', 'REFUND', 'PAYOUT_START', 'PAYOUT_DONE', 'PAYOUT_FEE', 'PAYOUT_FAIL', 'PAYOUT_REVERSED')`,
    ),
  ],
);

/**
 * Immutable debit and credit postings belonging to a {@link ledgerTransactions} record (SPEC.md sections 6.1 and 6.2).
 *
 * @example
 * ```ts
 * import { ledgerEntries } from "./schema.js";
 * ```
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: "restrict" }),
    ledgerAccountId: text("ledger_account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    direction: text("direction").notNull(),
    amountMicros: bigint("amount_micros", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_tx_idx").on(t.transactionId),
    index("ledger_entries_account_idx").on(t.ledgerAccountId),
    check("ledger_entries_direction_check", sql`${t.direction} IN ('debit', 'credit')`),
    check("ledger_entries_amount_pos", sql`${t.amountMicros} > 0`),
  ],
);

/**
 * Ed25519 facilitator signing keys with AES-256-GCM encrypted private keys (SPEC.md sections 4.6 and 6.1).
 *
 * @example
 * ```ts
 * import { signingKeys } from "./schema.js";
 * ```
 */
export const signingKeys = pgTable(
  "signing_keys",
  {
    kid: text("kid").primaryKey(),
    publicJwk: jsonb("public_jwk").notNull(),
    privateEnc: text("private_enc").notNull(),
    status: text("status").notNull().default("active"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("signing_keys_status_check", sql`${t.status} IN ('active', 'retired')`)],
);

/**
 * Verified PayPal webhook deliveries persisted for idempotent async processing (SPEC.md sections 6.1 and 8.5).
 *
 * @example
 * ```ts
 * import { webhookEvents } from "./schema.js";
 * ```
 */
export const webhookEvents = pgTable("webhook_events", {
  paypalEventId: text("paypal_event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Security-sensitive audit trail (never stores secrets, SPEC.md sections 6.1 and 8.7).
 *
 * @example
 * ```ts
 * import { auditLog } from "./schema.js";
 * ```
 */
export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  ip: text("ip"),
  meta: jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
