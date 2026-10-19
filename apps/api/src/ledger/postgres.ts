/**
 * PostgreSQL 16 transactional execution of {@link LedgerPostingPlan} and invariant checks (SPEC.md sections 6.2, 6.3, 8.5).
 */

import { createId, InsufficientFundsError } from "@haggles/core";
import type { Sql, TransactionSql } from "postgres";
import {
  assertPostingPlanBalanced,
  checkLedgerInvariants,
  computeBalanceDelta,
  type EntryDirection,
  type LedgerAccountKind,
  type LedgerAccountRow,
  type LedgerEntryRow,
  type LedgerInvariantReport,
  type LedgerPostingKind,
  type LedgerPostingPlan,
  type LedgerTransactionRow,
} from "./index.js";

/**
 * Ensures all accounts referenced in a {@link LedgerPostingPlan} exist in `ledger_accounts`
 * prior to locking and updating them.
 *
 * @param tx - Active `postgres.js` transaction
 * @param plan - Balanced posting plan
 */
async function ensureAccountsInPostgres(
  tx: TransactionSql,
  plan: LedgerPostingPlan,
): Promise<void> {
  const uniqueAccounts = new Map<
    string,
    { id: string; kind: LedgerAccountKind; ownerId: string | null }
  >();
  for (const e of plan.entries) {
    uniqueAccounts.set(e.accountId, {
      id: e.accountId,
      kind: e.accountKind,
      ownerId: e.ownerId,
    });
  }
  const sorted = [...uniqueAccounts.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const acc of sorted) {
    await tx.unsafe(
      `INSERT INTO ledger_accounts (id, kind, owner_id, balance_micros, version)
       VALUES ($1, $2, $3, 0, 0)
       ON CONFLICT (id) DO NOTHING`,
      [acc.id, acc.kind, acc.ownerId],
    );
  }
}

/**
 * Executes a {@link LedgerPostingPlan} inside an active PostgreSQL transaction with:
 * - Idempotency by `(reference_type, reference_id, kind)` unique constraint (SPEC.md section 6.3)
 * - Ascending `id` lock ordering to prevent deadlocks (SPEC.md section 6.3)
 * - Single-statement guarded `UPDATE ledger_accounts ... WHERE ... RETURNING` (SPEC.md section 6.3)
 *
 * @param tx - Active `postgres.js` transaction (`sql.begin(...)`)
 * @param plan - Balanced posting plan
 * @returns `{ transactionId, idempotentReplay }`
 * @throws {InsufficientFundsError} If any guarded account lacks sufficient balance
 *
 * @example
 * ```ts
 * await sql.begin(async (tx) => {
 *   await postLedgerPlanPostgres(tx, buildHoldPostingPlan("wal_01J...", "pay_01J...", 20_000n));
 * });
 * ```
 */
export async function postLedgerPlanPostgres(
  tx: TransactionSql,
  plan: LedgerPostingPlan,
): Promise<{ transactionId: string; idempotentReplay: boolean }> {
  assertPostingPlanBalanced(plan);

  const txId = createId("ltx");
  const insertedTx = await tx.unsafe<Array<{ id: string }>>(
    `INSERT INTO ledger_transactions (id, kind, reference_type, reference_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (reference_type, reference_id, kind) DO NOTHING
     RETURNING id`,
    [txId, plan.kind, plan.referenceType, plan.referenceId],
  );

  if (insertedTx.length === 0) {
    const existing = await tx.unsafe<Array<{ id: string }>>(
      `SELECT id FROM ledger_transactions
       WHERE reference_type = $1 AND reference_id = $2 AND kind = $3`,
      [plan.referenceType, plan.referenceId, plan.kind],
    );
    return { transactionId: existing[0]!.id, idempotentReplay: true };
  }

  await ensureAccountsInPostgres(tx, plan);

  // Aggregate net delta and guard requirement per account, sorted in ascending account ID order (SPEC 6.3)
  const aggregated = new Map<
    string,
    { accountId: string; delta: bigint; requireNonNegative: boolean }
  >();
  for (const e of plan.entries) {
    const delta = computeBalanceDelta(e.accountKind, e.direction, e.amountMicros);
    const prev = aggregated.get(e.accountId);
    if (prev) {
      prev.delta += delta;
      prev.requireNonNegative = prev.requireNonNegative || e.requireNonNegativeBalance;
    } else {
      aggregated.set(e.accountId, {
        accountId: e.accountId,
        delta,
        requireNonNegative: e.requireNonNegativeBalance,
      });
    }
  }

  const orderedUpdates = [...aggregated.values()].sort((a, b) =>
    a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0,
  );

  for (const u of orderedUpdates) {
    const updated = await tx.unsafe<Array<{ id: string; balance_micros: string }>>(
      `UPDATE ledger_accounts
       SET balance_micros = balance_micros + $2::bigint,
           version = version + 1
       WHERE id = $1
         AND ($3::boolean = false OR balance_micros + $2::bigint >= 0)
       RETURNING id, balance_micros::text`,
      [u.accountId, u.delta.toString(), u.requireNonNegative],
    );
    if (updated.length === 0) {
      throw new InsufficientFundsError(
        `Insufficient balance in ledger account ${u.accountId} for ${plan.kind}.`,
      );
    }
  }

  for (const e of plan.entries) {
    const entryId = `len_${createId("ltx").slice(4)}`;
    await tx.unsafe(
      `INSERT INTO ledger_entries (id, transaction_id, ledger_account_id, direction, amount_micros)
       VALUES ($1, $2, $3, $4, $5::bigint)`,
      [entryId, txId, e.accountId, e.direction, e.amountMicros.toString()],
    );
  }

  return { transactionId: txId, idempotentReplay: false };
}

/**
 * Queries all ledger tables in PostgreSQL and verifies all ledger invariants (SPEC.md section 8.5).
 *
 * @param sql - `postgres.js` SQL client
 * @returns {@link LedgerInvariantReport}
 *
 * @example
 * ```ts
 * const report = await verifyPostgresLedgerInvariants(sql);
 * ```
 */
export async function verifyPostgresLedgerInvariants(sql: Sql): Promise<LedgerInvariantReport> {
  const accountRows = await sql.unsafe<
    Array<{
      id: string;
      kind: LedgerAccountKind;
      owner_id: string | null;
      balance_micros: string;
      version: string;
    }>
  >(`SELECT id, kind, owner_id, balance_micros::text, version::text FROM ledger_accounts`);

  const txRows = await sql.unsafe<
    Array<{
      id: string;
      kind: LedgerPostingKind;
      reference_type: string;
      reference_id: string;
      created_at: Date;
    }>
  >(`SELECT id, kind, reference_type, reference_id, created_at FROM ledger_transactions`);

  const entryRows = await sql.unsafe<
    Array<{
      id: string;
      transaction_id: string;
      ledger_account_id: string;
      direction: EntryDirection;
      amount_micros: string;
    }>
  >(
    `SELECT id, transaction_id, ledger_account_id, direction, amount_micros::text FROM ledger_entries`,
  );

  const accounts: LedgerAccountRow[] = accountRows.map((r) => ({
    id: r.id,
    kind: r.kind,
    ownerId: r.owner_id,
    balanceMicros: BigInt(r.balance_micros),
    version: BigInt(r.version),
  }));

  const transactions: LedgerTransactionRow[] = txRows.map((r) => ({
    id: r.id,
    kind: r.kind,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    createdAt: new Date(r.created_at),
  }));

  const entries: LedgerEntryRow[] = entryRows.map((r) => ({
    id: r.id,
    transactionId: r.transaction_id,
    ledgerAccountId: r.ledger_account_id,
    direction: r.direction,
    amountMicros: BigInt(r.amount_micros),
  }));

  return checkLedgerInvariants(accounts, transactions, entries);
}
