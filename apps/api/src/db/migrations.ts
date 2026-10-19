/**
 * Initial PostgreSQL 16 schema migration for Haggles (SPEC.md sections 6.1, 6.2, 6.3).
 *
 * Includes all 17 tables, CHECK constraints, unique/partial indexes, global ledger accounts,
 * and the DEFERRABLE INITIALLY DEFERRED double-entry balance trigger required by SPEC.md section 6.2.
 */

export const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  paypal_payer_id text NOT NULL UNIQUE,
  paypal_user_id text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  paypal_verified_account boolean NOT NULL DEFAULT false,
  display_name text,
  is_buyer boolean NOT NULL DEFAULT false,
  is_seller boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_status_check CHECK (status IN ('active', 'frozen'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  id text PRIMARY KEY,
  account_id text NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_status_check CHECK (status IN ('active', 'frozen'))
);

CREATE TABLE IF NOT EXISTS agent_keys (
  id text PRIMARY KEY,
  wallet_id text NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  name text NOT NULL,
  prefix text NOT NULL UNIQUE,
  key_hash text NOT NULL,
  per_call_max_micros bigint NOT NULL DEFAULT 100000,
  daily_max_micros bigint NOT NULL DEFAULT 5000000,
  monthly_max_micros bigint,
  allowed_sellers text[],
  allowed_hosts text[],
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_keys_status_check CHECK (status IN ('active', 'revoked')),
  CONSTRAINT agent_keys_per_call_max_nonneg CHECK (per_call_max_micros >= 0),
  CONSTRAINT agent_keys_daily_max_nonneg CHECK (daily_max_micros >= 0),
  CONSTRAINT agent_keys_monthly_max_nonneg CHECK (monthly_max_micros IS NULL OR monthly_max_micros >= 0)
);

CREATE TABLE IF NOT EXISTS agent_key_spend (
  agent_key_id text NOT NULL REFERENCES agent_keys(id) ON DELETE CASCADE,
  period_kind text NOT NULL,
  period_start date NOT NULL,
  spent_micros bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_key_id, period_kind, period_start),
  CONSTRAINT agent_key_spend_period_kind_check CHECK (period_kind IN ('day', 'month')),
  CONSTRAINT agent_key_spend_nonneg CHECK (spent_micros >= 0)
);

CREATE TABLE IF NOT EXISTS sellers (
  id text PRIMARY KEY,
  account_id text NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  payout_paypal_payer_id text NOT NULL,
  payout_email text NOT NULL,
  payout_mode text NOT NULL DEFAULT 'paypal',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sellers_status_check CHECK (status IN ('active', 'paused')),
  CONSTRAINT sellers_payout_mode_check CHECK (payout_mode IN ('paypal', 'simulated'))
);

CREATE TABLE IF NOT EXISTS seller_keys (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  name text NOT NULL,
  prefix text NOT NULL UNIQUE,
  key_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_keys_status_check CHECK (status IN ('active', 'revoked'))
);

CREATE TABLE IF NOT EXISTS endpoints (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  method text NOT NULL,
  route text NOT NULL,
  display_name text,
  description text,
  last_price_micros bigint NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT endpoints_last_price_nonneg CHECK (last_price_micros >= 0),
  CONSTRAINT endpoints_status_check CHECK (status IN ('active', 'hidden'))
);

CREATE UNIQUE INDEX IF NOT EXISTS endpoints_seller_method_route_uq
  ON endpoints (seller_id, method, route);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  wallet_id text NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  agent_key_id text NOT NULL REFERENCES agent_keys(id) ON DELETE RESTRICT,
  seller_id text NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  endpoint_id text REFERENCES endpoints(id) ON DELETE SET NULL,
  amount_micros bigint NOT NULL,
  fee_micros bigint NOT NULL DEFAULT 0,
  method text NOT NULL,
  url text NOT NULL,
  challenge_id text NOT NULL,
  status text NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  captured_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  idempotency_key text NOT NULL,
  redeem_idempotency_key text,
  response_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_amount_nonneg CHECK (amount_micros >= 0),
  CONSTRAINT payments_fee_nonneg CHECK (fee_micros >= 0),
  CONSTRAINT payments_status_check CHECK (status IN ('authorized', 'captured', 'released', 'refunded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_agent_key_idempotency_uq
  ON payments (agent_key_id, idempotency_key);
CREATE INDEX IF NOT EXISTS payments_seller_created_idx
  ON payments (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_wallet_created_idx
  ON payments (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_authorized_expires_idx
  ON payments (expires_at) WHERE status = 'authorized';

CREATE TABLE IF NOT EXISTS topups (
  id text PRIMARY KEY,
  wallet_id text NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  amount_micros bigint NOT NULL,
  paypal_order_id text NOT NULL UNIQUE,
  paypal_capture_id text UNIQUE,
  paypal_fee_micros bigint,
  paypal_net_micros bigint,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topups_amount_nonneg CHECK (amount_micros >= 0),
  CONSTRAINT topups_fee_nonneg CHECK (paypal_fee_micros IS NULL OR paypal_fee_micros >= 0),
  CONSTRAINT topups_net_nonneg CHECK (paypal_net_micros IS NULL OR paypal_net_micros >= 0),
  CONSTRAINT topups_status_check CHECK (status IN ('created', 'pending', 'credited', 'failed', 'reversed'))
);

CREATE TABLE IF NOT EXISTS payouts (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  amount_micros bigint NOT NULL,
  batch_ref text NOT NULL,
  paypal_batch_id text,
  paypal_item_id text,
  paypal_fee_micros bigint,
  status text NOT NULL,
  mode text NOT NULL,
  failure_reason text,
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_amount_nonneg CHECK (amount_micros >= 0),
  CONSTRAINT payouts_fee_nonneg CHECK (paypal_fee_micros IS NULL OR paypal_fee_micros >= 0),
  CONSTRAINT payouts_status_check CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'reversed')),
  CONSTRAINT payouts_mode_check CHECK (mode IN ('paypal', 'simulated')),
  CONSTRAINT payouts_requested_by_check CHECK (requested_by IN ('schedule', 'seller'))
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id text PRIMARY KEY,
  kind text NOT NULL,
  owner_id text,
  balance_micros bigint NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_kind_check CHECK (
    kind IN ('W_AVAIL', 'W_HELD', 'S_PENDING', 'S_PAYOUT', 'G_PAYPAL', 'G_FEES', 'G_PAYPAL_FEES')
  ),
  CONSTRAINT ledger_accounts_balance_guard_check CHECK (
    (kind IN ('W_AVAIL', 'W_HELD', 'S_PAYOUT') AND balance_micros >= 0)
    OR kind NOT IN ('W_AVAIL', 'W_HELD', 'S_PAYOUT')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_kind_owner_uq
  ON ledger_accounts (kind, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_global_kind_uq
  ON ledger_accounts (kind) WHERE owner_id IS NULL;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id text PRIMARY KEY,
  kind text NOT NULL,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_transactions_kind_check CHECK (
    kind IN (
      'TOPUP',
      'HOLD',
      'RELEASE',
      'CAPTURE',
      'REFUND',
      'PAYOUT_START',
      'PAYOUT_DONE',
      'PAYOUT_FEE',
      'PAYOUT_FAIL',
      'PAYOUT_REVERSED'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_transactions_ref_kind_uq
  ON ledger_transactions (reference_type, reference_id, kind);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY,
  transaction_id text NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  ledger_account_id text NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  direction text NOT NULL,
  amount_micros bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_direction_check CHECK (direction IN ('debit', 'credit')),
  CONSTRAINT ledger_entries_amount_pos CHECK (amount_micros > 0)
);

CREATE INDEX IF NOT EXISTS ledger_entries_tx_idx ON ledger_entries (transaction_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries (ledger_account_id);

CREATE TABLE IF NOT EXISTS signing_keys (
  kid text PRIMARY KEY,
  public_jwk jsonb NOT NULL,
  private_enc text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signing_keys_status_check CHECK (status IN ('active', 'retired'))
);

CREATE TABLE IF NOT EXISTS webhook_events (
  paypal_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  account_id text REFERENCES accounts(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  ip text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Deferred double-entry balance trigger (SPEC.md section 6.2):
-- Every ledger_transaction MUST have at least 2 entries and SUM(debits) == SUM(credits).
CREATE OR REPLACE FUNCTION check_ledger_transaction_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tx_id text;
  debit_sum bigint;
  credit_sum bigint;
  entry_count integer;
BEGIN
  IF TG_TABLE_NAME = 'ledger_transactions' THEN
    tx_id := COALESCE(NEW.id, OLD.id);
  ELSE
    tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_micros ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_micros ELSE 0 END), 0)
  INTO entry_count, debit_sum, credit_sum
  FROM ledger_entries
  WHERE transaction_id = tx_id;

  IF entry_count < 2 THEN
    RAISE EXCEPTION 'ledger_transaction % must have at least 2 entries (found %)', tx_id, entry_count
      USING ERRCODE = '23514';
  END IF;

  IF debit_sum <> credit_sum THEN
    RAISE EXCEPTION 'ledger_transaction % is unbalanced: debits=% credits=%', tx_id, debit_sum, credit_sum
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_transactions_balanced ON ledger_transactions;
CREATE CONSTRAINT TRIGGER trg_ledger_transactions_balanced
  AFTER INSERT OR UPDATE ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_ledger_transaction_balanced();

DROP TRIGGER IF EXISTS trg_ledger_entries_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced
  AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_ledger_transaction_balanced();

-- Seed global singleton ledger accounts (SPEC.md section 6.2)
INSERT INTO ledger_accounts (id, kind, owner_id, balance_micros, version)
VALUES
  ('G_PAYPAL', 'G_PAYPAL', NULL, 0, 0),
  ('G_FEES', 'G_FEES', NULL, 0, 0),
  ('G_PAYPAL_FEES', 'G_PAYPAL_FEES', NULL, 0, 0)
ON CONFLICT (id) DO NOTHING;
`;
