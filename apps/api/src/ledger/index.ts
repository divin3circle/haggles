/**
 * Double-entry bookkeeping engine and invariant verifier (SPEC.md sections 6.2, 6.3, and 8.5).
 *
 * Every ledger transaction posts balanced debit and credit entries (`SUM(debits) == SUM(credits)`),
 * locks accounts in ascending `id` order to prevent deadlocks, enforces non-negative balance guards
 * on `W_AVAIL`, `W_HELD`, `S_PAYOUT` (and `S_PENDING` except during `REFUND`), and guarantees
 * idempotency by `(reference_type, reference_id, kind)`.
 */

import { computePlatformFeeMicros, createId, InsufficientFundsError, InvalidMoneyError } from "@haggles/core";

/**
 * Ledger account kinds defined in SPEC.md section 6.2.
 *
 * @example
 * ```ts
 * const kind: LedgerAccountKind = "W_AVAIL";
 * ```
 */
export type LedgerAccountKind =
  | "W_AVAIL"
  | "W_HELD"
  | "S_PENDING"
  | "S_PAYOUT"
  | "G_PAYPAL"
  | "G_FEES"
  | "G_PAYPAL_FEES";

/**
 * Allowed double-entry posting kinds defined in SPEC.md section 6.3.
 *
 * @example
 * ```ts
 * const postingKind: LedgerPostingKind = "CAPTURE";
 * ```
 */
export type LedgerPostingKind =
  | "TOPUP"
  | "HOLD"
  | "RELEASE"
  | "CAPTURE"
  | "REFUND"
  | "PAYOUT_START"
  | "PAYOUT_DONE"
  | "PAYOUT_FEE"
  | "PAYOUT_FAIL"
  | "PAYOUT_REVERSED";

/**
 * Direction of a ledger entry posting.
 *
 * @example
 * ```ts
 * const dir: EntryDirection = "debit";
 * ```
 */
export type EntryDirection = "debit" | "credit";

/**
 * Materialized ledger account state (SPEC.md section 6.1 and 6.2).
 *
 * @example
 * ```ts
 * const acct: LedgerAccountRow = {
 *   id: "w_avail:wal_01J...",
 *   kind: "W_AVAIL",
 *   ownerId: "wal_01J...",
 *   balanceMicros: 5_000_000n,
 *   version: 1n,
 * };
 * ```
 */
export interface LedgerAccountRow {
  id: string;
  kind: LedgerAccountKind;
  ownerId: string | null;
  balanceMicros: bigint;
  version: bigint;
}

/**
 * Recorded ledger transaction row (SPEC.md section 6.1).
 *
 * @example
 * ```ts
 * const tx: LedgerTransactionRow = {
 *   id: "ltx_01J...",
 *   kind: "HOLD",
 *   referenceType: "payment",
 *   referenceId: "pay_01J...",
 *   createdAt: new Date(),
 * };
 * ```
 */
export interface LedgerTransactionRow {
  id: string;
  kind: LedgerPostingKind;
  referenceType: string;
  referenceId: string;
  createdAt: Date;
}

/**
 * Recorded ledger entry row (SPEC.md section 6.1).
 *
 * @example
 * ```ts
 * const entry: LedgerEntryRow = {
 *   id: "len_01J...",
 *   transactionId: "ltx_01J...",
 *   ledgerAccountId: "w_avail:wal_01J...",
 *   direction: "debit",
 *   amountMicros: 20_000n,
 * };
 * ```
 */
export interface LedgerEntryRow {
  id: string;
  transactionId: string;
  ledgerAccountId: string;
  direction: EntryDirection;
  amountMicros: bigint;
}

/**
 * Planned entry within a balanced posting specification.
 *
 * @example
 * ```ts
 * const spec: PlannedLedgerEntry = {
 *   accountId: walletAvailAccountId("wal_01J..."),
 *   accountKind: "W_AVAIL",
 *   ownerId: "wal_01J...",
 *   direction: "debit",
 *   amountMicros: 20_000n,
 *   requireNonNegativeBalance: true,
 * };
 * ```
 */
export interface PlannedLedgerEntry {
  accountId: string;
  accountKind: LedgerAccountKind;
  ownerId: string | null;
  direction: EntryDirection;
  amountMicros: bigint;
  /** When true, the post-update `balance_micros` MUST remain `>= 0n` */
  requireNonNegativeBalance: boolean;
}

/**
 * Complete specification for one atomic double-entry posting (SPEC.md section 6.3).
 *
 * @example
 * ```ts
 * const plan = buildHoldPostingPlan("wal_01J...", "pay_01J...", 20_000n);
 * ```
 */
export interface LedgerPostingPlan {
  kind: LedgerPostingKind;
  referenceType: "topup" | "payment" | "payout";
  referenceId: string;
  entries: PlannedLedgerEntry[];
}

/**
 * Result of verifying all ledger invariants (SPEC.md sections 6.2 and 8.5).
 *
 * @example
 * ```ts
 * const report = checkLedgerInvariants(accounts, transactions, entries);
 * console.log(report.ok); // true
 * ```
 */
export interface LedgerInvariantReport {
  ok: boolean;
  violations: string[];
  totals: {
    gPaypal: bigint;
    gPaypalFees: bigint;
    wAvail: bigint;
    wHeld: bigint;
    sPending: bigint;
    sPayout: bigint;
    gFees: bigint;
    assetsPlusExpenses: bigint;
    liabilitiesPlusRevenue: bigint;
  };
}

/**
 * Returns the deterministic ledger account ID for a buyer wallet's `W_AVAIL` account.
 *
 * @param walletId - Wallet ID (`wal_...`)
 * @returns `"w_avail:<walletId>"`
 *
 * @example
 * ```ts
 * walletAvailAccountId("wal_01J9Z3K4M5N6P7Q8R9S0T1U2V3");
 * ```
 */
export function walletAvailAccountId(walletId: string): string {
  return `w_avail:${walletId}`;
}

/**
 * Returns the deterministic ledger account ID for a buyer wallet's `W_HELD` account.
 *
 * @param walletId - Wallet ID (`wal_...`)
 * @returns `"w_held:<walletId>"`
 *
 * @example
 * ```ts
 * walletHeldAccountId("wal_01J9Z3K4M5N6P7Q8R9S0T1U2V3");
 * ```
 */
export function walletHeldAccountId(walletId: string): string {
  return `w_held:${walletId}`;
}

/**
 * Returns the deterministic ledger account ID for a seller's `S_PENDING` account.
 *
 * @param sellerId - Seller ID (`slr_...`)
 * @returns `"s_pending:<sellerId>"`
 *
 * @example
 * ```ts
 * sellerPendingAccountId("slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3");
 * ```
 */
export function sellerPendingAccountId(sellerId: string): string {
  return `s_pending:${sellerId}`;
}

/**
 * Returns the deterministic ledger account ID for a seller's `S_PAYOUT` account.
 *
 * @param sellerId - Seller ID (`slr_...`)
 * @returns `"s_payout:<sellerId>"`
 *
 * @example
 * ```ts
 * sellerPayoutAccountId("slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3");
 * ```
 */
export function sellerPayoutAccountId(sellerId: string): string {
  return `s_payout:${sellerId}`;
}

/**
 * Returns `true` if the account kind is an asset or expense (`balance = debits - credits`),
 * or `false` if it is a liability or revenue (`balance = credits - debits`, SPEC.md section 6.2).
 *
 * @param kind - Ledger account kind
 * @returns `true` for `G_PAYPAL` and `G_PAYPAL_FEES`
 *
 * @example
 * ```ts
 * isDebitNormalAccount("G_PAYPAL"); // true
 * isDebitNormalAccount("W_AVAIL");  // false
 * ```
 */
export function isDebitNormalAccount(kind: LedgerAccountKind): boolean {
  return kind === "G_PAYPAL" || kind === "G_PAYPAL_FEES";
}

/**
 * Computes the signed change in `balance_micros` produced by an entry on an account of `kind` (SPEC.md section 6.2).
 *
 * - Asset/Expense (`G_PAYPAL`, `G_PAYPAL_FEES`): `debit` is `+amount`, `credit` is `-amount`.
 * - Liability/Revenue (`W_AVAIL`, `W_HELD`, `S_PENDING`, `S_PAYOUT`, `G_FEES`): `credit` is `+amount`, `debit` is `-amount`.
 *
 * @param kind - Ledger account kind
 * @param direction - Entry direction (`"debit"` or `"credit"`)
 * @param amountMicros - Positive entry amount (`> 0n`)
 * @returns Signed delta to add to `balance_micros`
 *
 * @example
 * ```ts
 * computeBalanceDelta("W_AVAIL", "credit", 5_000_000n); // +5000000n
 * computeBalanceDelta("W_AVAIL", "debit", 20_000n);     // -20000n
 * ```
 */
export function computeBalanceDelta(
  kind: LedgerAccountKind,
  direction: EntryDirection,
  amountMicros: bigint,
): bigint {
  if (isDebitNormalAccount(kind)) {
    return direction === "debit" ? amountMicros : -amountMicros;
  }
  return direction === "credit" ? amountMicros : -amountMicros;
}

/**
 * Validates that a posting plan has positive entry amounts and balanced debits and credits.
 *
 * @param plan - Candidate {@link LedgerPostingPlan}
 * @throws {InvalidMoneyError} If any entry is `<= 0n` or `SUM(debits) !== SUM(credits)`
 *
 * @example
 * ```ts
 * assertPostingPlanBalanced(plan);
 * ```
 */
export function assertPostingPlanBalanced(plan: LedgerPostingPlan): void {
  if (plan.entries.length < 2) {
    throw new InvalidMoneyError(`Posting ${plan.kind} requires at least 2 entries.`);
  }
  let debits = 0n;
  let credits = 0n;
  for (const e of plan.entries) {
    if (e.amountMicros <= 0n) {
      throw new InvalidMoneyError(
        `Entry amount must be > 0 for ${plan.kind} on ${e.accountId}, got ${e.amountMicros.toString()}.`,
      );
    }
    if (e.direction === "debit") debits += e.amountMicros;
    else credits += e.amountMicros;
  }
  if (debits !== credits) {
    throw new InvalidMoneyError(
      `Unbalanced posting ${plan.kind}: debits=${debits.toString()} credits=${credits.toString()}.`,
    );
  }
}

/**
 * Posting #1 (`TOPUP`, SPEC.md section 6.3):
 * Debits `G_PAYPAL` (`A - F`) and `G_PAYPAL_FEES` (`F` if `F > 0`); Credits `W_AVAIL` (`A`).
 *
 * @example
 * ```ts
 * const plan = buildTopupPostingPlan("wal_01J...", "top_01J...", 5_000_000n, 450_000n);
 * ```
 */
export function buildTopupPostingPlan(
  walletId: string,
  topupId: string,
  grossAmountMicros: bigint,
  paypalFeeMicros: bigint,
): LedgerPostingPlan {
  if (grossAmountMicros <= 0n || paypalFeeMicros < 0n || paypalFeeMicros > grossAmountMicros) {
    throw new InvalidMoneyError("Invalid top-up gross or fee amount.");
  }
  const netMicros = grossAmountMicros - paypalFeeMicros;
  const entries: PlannedLedgerEntry[] = [];
  if (netMicros > 0n) {
    entries.push({
      accountId: "G_PAYPAL",
      accountKind: "G_PAYPAL",
      ownerId: null,
      direction: "debit",
      amountMicros: netMicros,
      requireNonNegativeBalance: false,
    });
  }
  if (paypalFeeMicros > 0n) {
    entries.push({
      accountId: "G_PAYPAL_FEES",
      accountKind: "G_PAYPAL_FEES",
      ownerId: null,
      direction: "debit",
      amountMicros: paypalFeeMicros,
      requireNonNegativeBalance: false,
    });
  }
  entries.push({
    accountId: walletAvailAccountId(walletId),
    accountKind: "W_AVAIL",
    ownerId: walletId,
    direction: "credit",
    amountMicros: grossAmountMicros,
    requireNonNegativeBalance: true,
  });
  const plan: LedgerPostingPlan = {
    kind: "TOPUP",
    referenceType: "topup",
    referenceId: topupId,
    entries,
  };
  assertPostingPlanBalanced(plan);
  return plan;
}

/**
 * Posting #2 (`HOLD`, SPEC.md section 6.3):
 * Debits `W_AVAIL` (`P`); Credits `W_HELD` (`P`).
 *
 * @example
 * ```ts
 * const plan = buildHoldPostingPlan("wal_01J...", "pay_01J...", 20_000n);
 * ```
 */
export function buildHoldPostingPlan(
  walletId: string,
  paymentId: string,
  amountMicros: bigint,
): LedgerPostingPlan {
  if (amountMicros <= 0n) {
    throw new InvalidMoneyError("Hold amount must be > 0.");
  }
  const plan: LedgerPostingPlan = {
    kind: "HOLD",
    referenceType: "payment",
    referenceId: paymentId,
    entries: [
      {
        accountId: walletAvailAccountId(walletId),
        accountKind: "W_AVAIL",
        ownerId: walletId,
        direction: "debit",
        amountMicros,
        requireNonNegativeBalance: true,
      },
      {
        accountId: walletHeldAccountId(walletId),
        accountKind: "W_HELD",
        ownerId: walletId,
        direction: "credit",
        amountMicros,
        requireNonNegativeBalance: true,
      },
    ],
  };
  assertPostingPlanBalanced(plan);
  return plan;
}

/**
 * Posting #3 (`RELEASE`, SPEC.md section 6.3):
 * Debits `W_HELD` (`P`); Credits `W_AVAIL` (`P`).
 *
 * @example
 * ```ts
 * const plan = buildReleasePostingPlan("wal_01J...", "pay_01J...", 20_000n);
 * ```
 */
export function buildReleasePostingPlan(
  walletId: string,
  paymentId: string,
  amountMicros: bigint,
): LedgerPostingPlan {
  if (amountMicros <= 0n) {
    throw new InvalidMoneyError("Release amount must be > 0.");
  }
  const plan: LedgerPostingPlan = {
    kind: "RELEASE",
    referenceType: "payment",
    referenceId: paymentId,
    entries: [
      {
        accountId: walletHeldAccountId(walletId),
        accountKind: "W_HELD",
        ownerId: walletId,
        direction: "debit",
        amountMicros,
        requireNonNegativeBalance: true,
      },
      {
        accountId: walletAvailAccountId(walletId),
        accountKind: "W_AVAIL",
        ownerId: walletId,
        direction: "credit",
        amountMicros,
        requireNonNegativeBalance: true,
      },
    ],
  };
  assertPostingPlanBalanced(plan);
  return plan;
}

/**
 * Posting #4 (`CAPTURE`, SPEC.md section 6.3):
 * Debits `W_HELD` (`P`); Credits `S_PENDING` (`P - f`) and `G_FEES` (`f`).
 *
 * @example
 * ```ts
 * const plan = buildCapturePostingPlan("wal_01J...", "slr_01J...", "pay_01J...", 20_000n, 1_000n);
 * ```
 */
export function buildCapturePostingPlan(
  walletId: string,
  sellerId: string,
  paymentId: string,
  amountMicros: bigint,
  feeMicros: bigint,
): LedgerPostingPlan {
  if (amountMicros <= 0n || feeMicros < 0n || feeMicros > amountMicros) {
    throw new InvalidMoneyError("Invalid capture gross or platform fee amount.");
  }
  const sellerNet = amountMicros - feeMicros;
  const entries: PlannedLedgerEntry[] = [
    {
      accountId: walletHeldAccountId(walletId),
      accountKind: "W_HELD",
      ownerId: walletId,
      direction: "debit",
      amountMicros,
      requireNonNegativeBalance: true,
    },
  ];
  if (sellerNet > 0n) {
    entries.push({
      accountId: sellerPendingAccountId(sellerId),
      accountKind: "S_PENDING",
      ownerId: sellerId,
      direction: "credit",
      amountMicros: sellerNet,
      requireNonNegativeBalance: false,
    });
  }
  if (feeMicros > 0n) {
    entries.push({
      accountId: "G_FEES",
      accountKind: "G_FEES",
      ownerId: null,
      direction: "credit",
      amountMicros: feeMicros,
      requireNonNegativeBalance: false,
    });
  }
  const plan: LedgerPostingPlan = {
    kind: "CAPTURE",
    referenceType: "payment",
    referenceId: paymentId,
    entries,
  };
  assertPostingPlanBalanced(plan);
  return plan;
}

/**
 * Posting #5 (`REFUND`, SPEC.md section 6.3):
 * Debits `S_PENDING` (`P - f`, allowed to go negative per SPEC 6.2/6.3) and `G_FEES` (`f`);
 * Credits `W_AVAIL` (`P`).
 *
 * @example
 * ```ts
 * const plan = buildRefundPostingPlan("wal_01J...", "slr_01J...", "pay_01J...", 20_000n, 1_000n);
 * ```
 */
export function buildRefundPostingPlan(
  walletId: string,
  sellerId: string,
  paymentId: string,
  amountMicros: bigint,
  feeMicros: bigint,
): LedgerPostingPlan {
  if (amountMicros <= 0n || feeMicros < 0n || feeMicros > amountMicros) {
    throw new InvalidMoneyError("Invalid refund gross or platform fee amount.");
  }
  const sellerNet = amountMicros - feeMicros;
  const entries: PlannedLedgerEntry[] = [];
  if (sellerNet > 0n) {
    entries.push({
      accountId: sellerPendingAccountId(sellerId),
      accountKind: "S_PENDING",
      ownerId: sellerId,
      direction: "debit",
      amountMicros: sellerNet,
      requireNonNegativeBalance: false, // S_PENDING may go negative ONLY via refunds (SPEC 6.2)
    });
  }
  if (feeMicros > 0n) {
    entries.push({
      accountId: "G_FEES",
      accountKind: "G_FEES",
      ownerId: null,
      direction: "debit",
      amountMicros: feeMicros,
      requireNonNegativeBalance: false,
    });
  }
  entries.push({
    accountId: walletAvailAccountId(walletId),
    accountKind: "W_AVAIL",
    ownerId: walletId,
    direction: "credit",
    amountMicros,
    requireNonNegativeBalance: true,
  });
  const plan: LedgerPostingPlan = {
    kind: "REFUND",
    referenceType: "payment",
    referenceId: paymentId,
    entries,
  };
  assertPostingPlanBalanced(plan);
  return plan;
}

/**
 * Posting #6 (`PAYOUT_START`, SPEC.md section 6.3):
 * Debits `S_PENDING` (`X`, guarded `>= 0`); Credits `S_PAYOUT` (`X`).
 *
 * @example
 * ```ts
 * const plan = buildPayoutStartPostingPlan("slr_01J...", "pot_01J...", 1_000_000n);
 * ```
 */
export function buildPayoutStartPostingPlan(
  sellerId: string,
  payoutId: string,
  amountMicros: bigint,
): LedgerPostingPlan {
  if (amountMicros <= 0n) {
    throw new InvalidMoneyError("Payout amount must be > 0.");
  }
  const plan: LedgerPostingPlan = {
    kind: "PAYOUT_START",
    referenceType: "payout",
    referenceId: payoutId,
    entries: [
      {
        accountId: sellerPendingAccountId(sellerId),
        accountKind: "S_PENDING",
        ownerId: sellerId,
        direction: "debit",
        amountMicros,
        requireNonNegativeBalance: true,
      },
      {
        accountId: sellerPayoutAccountId(sellerId),
        accountKind: "S_PAYOUT",
        ownerId: sellerId,
        direction: "credit",
        amountMicros,
        requireNonNegativeBalance: true,
      },
    ],
  };
  assertPostingPlanBalanced(plan);
  return plan;
}

/**
 * Posting #7 (`PAYOUT_DONE`, SPEC.md section 6.3):
 * Debits `S_PAYOUT` (`X`); Credits `G_PAYPAL` (`X`).
 *
 * @example
 * ```ts
 * const plan = buildPayoutDonePostingPlan("slr_01J...", "pot_01J...", 1_000_000n);
 * ```
 */
export function buildPayoutDonePostingPlan(
  sellerId: string,
  payoutId: string,
  amountMicros: bigint,
): LedgerPostingPlan {
  if (amountMicros <= 0n) {
    throw new InvalidMoneyError("Payout done amount must be > 0.");
  }
  const plan: LedgerPostingPlan = {
    kind: "PAYOUT_DONE",
    referenceType: "payout",
    referenceId: payoutId,
    entries: [
      {
        accountId: sellerPayoutAccountId(sellerId),
        accountKind: "S_PAYOUT",
        ownerId: sellerId,
        direction: "debit",
        amountMicros,
        requireNonNegativeBalance: true,
      },
      {
        accountId: "G_PAYPAL",
        accountKind: "G_PAYPAL",
        ownerId: null,
        direction: "credit",
        amountMicros,
        requireNonNegativeBalance: false,
      },
    ],
  };
  assertPostingPlanBalanced(plan);
  return plan;
}

/**
 * Posting #7b (`PAYOUT_FEE`, SPEC.md section 6.3):
 * Debits `G_PAYPAL_FEES` (`x`); Credits `G_PAYPAL` (`x`).
 *
 * @example
 * ```ts
 * const plan = buildPayoutFeePostingPlan("pot_01J...", 250_000n);
 * ```
 */
export function buildPayoutFeePostingPlan(
  payoutId: string,
  feeMicros: bigint,
): LedgerPostingPlan {
  if (feeMicros <= 0n) {
    throw new InvalidMoneyError("Payout fee posting amount must be > 0.");
  }
  const plan: LedgerPostingPlan = {
    kind: "PAYOUT_FEE",
    referenceType: "payout",
    referenceId: payoutId,
    entries: [
      {
        accountId: "G_PAYPAL_FEES",
        accountKind: "G_PAYPAL_FEES",
        ownerId: null,
        direction: "debit",
        amountMicros: feeMicros,
        requireNonNegativeBalance: false,
      },
      {
        accountId: "G_PAYPAL",
        accountKind: "G_PAYPAL",
        ownerId: null,
        direction: "credit",
        amountMicros: feeMicros,
        requireNonNegativeBalance: false,
      },
    ],
  };
  assertPostingPlanBalanced(plan);
  return plan;
}

/**
 * Posting #8 (`PAYOUT_FAIL`, SPEC.md section 6.3):
 * Debits `S_PAYOUT` (`X`); Credits `S_PENDING` (`X`).
 *
 * @example
 * ```ts
 * const plan = buildPayoutFailPostingPlan("slr_01J...", "pot_01J...", 1_000_000n);
 * ```
 */
export function buildPayoutFailPostingPlan(
  sellerId: string,
  payoutId: string,
  amountMicros: bigint,
): LedgerPostingPlan {
  if (amountMicros <= 0n) {
    throw new InvalidMoneyError("Payout fail amount must be > 0.");
  }
  const plan: LedgerPostingPlan = {
    kind: "PAYOUT_FAIL",
    referenceType: "payout",
    referenceId: payoutId,
    entries: [
      {
        accountId: sellerPayoutAccountId(sellerId),
        accountKind: "S_PAYOUT",
        ownerId: sellerId,
        direction: "debit",
        amountMicros,
        requireNonNegativeBalance: true,
      },
      {
        accountId: sellerPendingAccountId(sellerId),
        accountKind: "S_PENDING",
        ownerId: sellerId,
        direction: "credit",
        amountMicros,
        requireNonNegativeBalance: false,
      },
    ],
  };
  assertPostingPlanBalanced(plan);
  return plan;
}

/**
 * Posting #9 (`PAYOUT_REVERSED`, SPEC.md section 6.3):
 * Debits `G_PAYPAL` (`X`); Credits `S_PENDING` (`X`).
 *
 * @example
 * ```ts
 * const plan = buildPayoutReversedPostingPlan("slr_01J...", "pot_01J...", 1_000_000n);
 * ```
 */
export function buildPayoutReversedPostingPlan(
  sellerId: string,
  payoutId: string,
  amountMicros: bigint,
): LedgerPostingPlan {
  if (amountMicros <= 0n) {
    throw new InvalidMoneyError("Payout reversed amount must be > 0.");
  }
  const plan: LedgerPostingPlan = {
    kind: "PAYOUT_REVERSED",
    referenceType: "payout",
    referenceId: payoutId,
    entries: [
      {
        accountId: "G_PAYPAL",
        accountKind: "G_PAYPAL",
        ownerId: null,
        direction: "debit",
        amountMicros,
        requireNonNegativeBalance: false,
      },
      {
        accountId: sellerPendingAccountId(sellerId),
        accountKind: "S_PENDING",
        ownerId: sellerId,
        direction: "credit",
        amountMicros,
        requireNonNegativeBalance: false,
      },
    ],
  };
  assertPostingPlanBalanced(plan);
  return plan;
}

/**
 * Verifies all ledger invariants defined in SPEC.md sections 6.2 and 8.5:
 * 1. Every `ledger_transaction` has `>= 2` entries and `SUM(debits) == SUM(credits)`.
 * 2. Every `ledger_account.balance_micros` equals the sum of its entries (`credits - debits` for liability/revenue, `debits - credits` for asset/expense).
 * 3. Guarded accounts (`W_AVAIL`, `W_HELD`, `S_PAYOUT`) have `balance_micros >= 0`.
 * 4. The global accounting identity holds: `G_PAYPAL + G_PAYPAL_FEES == SUM(W_AVAIL) + SUM(W_HELD) + SUM(S_PENDING) + SUM(S_PAYOUT) + G_FEES`.
 *
 * @param accounts - All ledger account rows
 * @param transactions - All ledger transaction rows
 * @param entries - All ledger entry rows
 * @returns {@link LedgerInvariantReport}
 *
 * @example
 * ```ts
 * const report = checkLedgerInvariants(accounts, transactions, entries);
 * if (!report.ok) throw new Error(report.violations.join("; "));
 * ```
 */
export function checkLedgerInvariants(
  accounts: ReadonlyArray<LedgerAccountRow>,
  transactions: ReadonlyArray<LedgerTransactionRow>,
  entries: ReadonlyArray<LedgerEntryRow>,
): LedgerInvariantReport {
  const violations: string[] = [];

  // 1. Every transaction balanced
  const entriesByTx = new Map<string, LedgerEntryRow[]>();
  for (const entry of entries) {
    if (entry.amountMicros <= 0n) {
      violations.push(`Entry ${entry.id} has non-positive amount ${entry.amountMicros.toString()}`);
    }
    const list = entriesByTx.get(entry.transactionId) ?? [];
    list.push(entry);
    entriesByTx.set(entry.transactionId, list);
  }

  for (const tx of transactions) {
    const txEntries = entriesByTx.get(tx.id) ?? [];
    if (txEntries.length < 2) {
      violations.push(`Transaction ${tx.id} (${tx.kind}) has fewer than 2 entries (${txEntries.length})`);
    }
    let debits = 0n;
    let credits = 0n;
    for (const e of txEntries) {
      if (e.direction === "debit") debits += e.amountMicros;
      else credits += e.amountMicros;
    }
    if (debits !== credits) {
      violations.push(
        `Transaction ${tx.id} (${tx.kind}) unbalanced: debits=${debits.toString()} credits=${credits.toString()}`,
      );
    }
  }

  // 2. Materialized balances equal entry sums, and guarded accounts >= 0
  const accountById = new Map<string, LedgerAccountRow>();
  for (const acc of accounts) {
    accountById.set(acc.id, acc);
  }

  const computedByAccount = new Map<string, bigint>();
  for (const acc of accounts) {
    computedByAccount.set(acc.id, 0n);
  }

  for (const entry of entries) {
    const acc = accountById.get(entry.ledgerAccountId);
    if (!acc) {
      violations.push(`Entry ${entry.id} references unknown account ${entry.ledgerAccountId}`);
      continue;
    }
    const delta = computeBalanceDelta(acc.kind, entry.direction, entry.amountMicros);
    computedByAccount.set(acc.id, (computedByAccount.get(acc.id) ?? 0n) + delta);
  }

  let gPaypal = 0n;
  let gPaypalFees = 0n;
  let wAvail = 0n;
  let wHeld = 0n;
  let sPending = 0n;
  let sPayout = 0n;
  let gFees = 0n;

  for (const acc of accounts) {
    const computed = computedByAccount.get(acc.id) ?? 0n;
    if (acc.balanceMicros !== computed) {
      violations.push(
        `Account ${acc.id} (${acc.kind}) materialized balance ${acc.balanceMicros.toString()} != entry sum ${computed.toString()}`,
      );
    }
    if (
      (acc.kind === "W_AVAIL" || acc.kind === "W_HELD" || acc.kind === "S_PAYOUT") &&
      acc.balanceMicros < 0n
    ) {
      violations.push(
        `Guarded account ${acc.id} (${acc.kind}) is negative: ${acc.balanceMicros.toString()}`,
      );
    }
    switch (acc.kind) {
      case "G_PAYPAL":
        gPaypal += acc.balanceMicros;
        break;
      case "G_PAYPAL_FEES":
        gPaypalFees += acc.balanceMicros;
        break;
      case "W_AVAIL":
        wAvail += acc.balanceMicros;
        break;
      case "W_HELD":
        wHeld += acc.balanceMicros;
        break;
      case "S_PENDING":
        sPending += acc.balanceMicros;
        break;
      case "S_PAYOUT":
        sPayout += acc.balanceMicros;
        break;
      case "G_FEES":
        gFees += acc.balanceMicros;
        break;
    }
  }

  // 3. Global accounting identity (SPEC 8.5):
  // G_PAYPAL + G_PAYPAL_FEES == W_AVAIL + W_HELD + S_PENDING + S_PAYOUT + G_FEES
  const assetsPlusExpenses = gPaypal + gPaypalFees;
  const liabilitiesPlusRevenue = wAvail + wHeld + sPending + sPayout + gFees;
  if (assetsPlusExpenses !== liabilitiesPlusRevenue) {
    violations.push(
      `Accounting identity violated: G_PAYPAL+G_PAYPAL_FEES (${assetsPlusExpenses.toString()}) != W_AVAIL+W_HELD+S_PENDING+S_PAYOUT+G_FEES (${liabilitiesPlusRevenue.toString()})`,
    );
  }

  return {
    ok: violations.length === 0,
    violations,
    totals: {
      gPaypal,
      gPaypalFees,
      wAvail,
      wHeld,
      sPending,
      sPayout,
      gFees,
      assetsPlusExpenses,
      liabilitiesPlusRevenue,
    },
  };
}

/**
 * Self-contained transactional in-memory double-entry ledger used for fast property-based
 * and concurrency testing as well as local/mock runs (implements identical lock-ordering,
 * idempotency, and balance guards to PostgreSQL).
 *
 * @example
 * ```ts
 * const ledger = new InMemoryLedger();
 * ledger.post(buildTopupPostingPlan("wal_01J...", "top_01J...", 5_000_000n, 0n));
 * ```
 */
export class InMemoryLedger {
  private readonly accounts = new Map<string, LedgerAccountRow>();
  private readonly transactions = new Map<string, LedgerTransactionRow>();
  private readonly txByRefKind = new Map<string, LedgerTransactionRow>();
  private readonly entries: LedgerEntryRow[] = [];

  constructor() {
    this.ensureAccount("G_PAYPAL", "G_PAYPAL", null);
    this.ensureAccount("G_FEES", "G_FEES", null);
    this.ensureAccount("G_PAYPAL_FEES", "G_PAYPAL_FEES", null);
  }

  /**
   * Ensures a ledger account exists and returns its row.
   */
  ensureAccount(id: string, kind: LedgerAccountKind, ownerId: string | null): LedgerAccountRow {
    const existing = this.accounts.get(id);
    if (existing) return existing;
    const created: LedgerAccountRow = {
      id,
      kind,
      ownerId,
      balanceMicros: 0n,
      version: 0n,
    };
    this.accounts.set(id, created);
    return created;
  }

  /**
   * Reads the current balance of a ledger account (`0n` if not yet created).
   */
  getBalance(accountId: string): bigint {
    return this.accounts.get(accountId)?.balanceMicros ?? 0n;
  }

  /**
   * Atomically executes a {@link LedgerPostingPlan} with idempotency by `(referenceType, referenceId, kind)`
   * and ascending account ID lock ordering (SPEC.md section 6.3).
   *
   * @param plan - Balanced posting plan
   * @returns `{ transaction, idempotentReplay }`
   * @throws {InsufficientFundsError} If a guarded account would go negative
   */
  post(plan: LedgerPostingPlan): { transaction: LedgerTransactionRow; idempotentReplay: boolean } {
    assertPostingPlanBalanced(plan);

    const refKey = `${plan.referenceType}:${plan.referenceId}:${plan.kind}`;
    const existingTx = this.txByRefKind.get(refKey);
    if (existingTx) {
      return { transaction: existingTx, idempotentReplay: true };
    }

    // Ensure all target accounts exist and sort entries by ascending accountId (lock ordering, SPEC 6.3)
    const sortedEntries = [...plan.entries].sort((a, b) =>
      a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0,
    );

    // Stage balance updates atomically so any guard failure aborts the entire posting
    const stagedBalances = new Map<string, bigint>();
    for (const e of sortedEntries) {
      const acc = this.ensureAccount(e.accountId, e.accountKind, e.ownerId);
      const current = stagedBalances.get(acc.id) ?? acc.balanceMicros;
      const next = current + computeBalanceDelta(acc.kind, e.direction, e.amountMicros);
      if (e.requireNonNegativeBalance && next < 0n) {
        throw new InsufficientFundsError(
          `Insufficient balance in ${acc.id}: available ${current.toString()} micros cannot cover ${e.amountMicros.toString()} micros.`,
        );
      }
      stagedBalances.set(acc.id, next);
    }

    // Commit account balance updates and entries
    for (const [accId, nextBal] of stagedBalances.entries()) {
      const acc = this.accounts.get(accId)!;
      acc.balanceMicros = nextBal;
      acc.version += 1n;
    }

    const tx: LedgerTransactionRow = {
      id: createId("ltx"),
      kind: plan.kind,
      referenceType: plan.referenceType,
      referenceId: plan.referenceId,
      createdAt: new Date(),
    };
    this.transactions.set(tx.id, tx);
    this.txByRefKind.set(refKey, tx);

    for (const e of plan.entries) {
      this.entries.push({
        id: `len_${createId("ltx").slice(4)}`,
        transactionId: tx.id,
        ledgerAccountId: e.accountId,
        direction: e.direction,
        amountMicros: e.amountMicros,
      });
    }

    return { transaction: tx, idempotentReplay: false };
  }

  /**
   * Runs {@link checkLedgerInvariants} on the current state of this ledger.
   */
  verifyInvariants(): LedgerInvariantReport {
    return checkLedgerInvariants(
      Array.from(this.accounts.values()),
      Array.from(this.transactions.values()),
      this.entries,
    );
  }
}

export { computePlatformFeeMicros };
