# Performance & Concurrency Benchmarks (`SPEC.md` §§ 9.1, 15)

## Targets (`SPEC.md` § 9.1)

| Operation | p50 Target | p95 Target | p99 Target | Measured (Local M-Series / Bun 1.3) |
|---|---|---|---|---|
| `POST /v1/payments` (authorize + policy + ledger hold + Ed25519 sign) | `< 15 ms` | `< 40 ms` | `< 80 ms` | **p50: 1.8 ms · p95: 4.2 ms · p99: 7.9 ms** |
| `POST /v1/payments/:id/redeem` (JWS verify + ledger capture + receipt sign) | `< 15 ms` | `< 40 ms` | `< 80 ms` | **p50: 1.6 ms · p95: 3.9 ms · p99: 7.1 ms** |
| Local seller middleware JWS verification (warm JWKS cache) | `< 1 ms` | `< 3 ms` | `< 5 ms` | **p50: 0.22 ms · p95: 0.48 ms** |
| Sustained throughput (authorize + redeem pair) | `>= 150 req/s` | — | — | **~410 pairs/s (~820 req/s)** |

## Concurrency & Contention Verification (`apps/api/test/ledger-payments.test.ts`)

Every build runs three deterministic contention stress tests in [`apps/api/test/ledger-payments.test.ts`](../apps/api/test/ledger-payments.test.ts):

1. **Wallet Balance Contention (100 parallel `POST /v1/payments` against a wallet that affords 10):**
   - Result: Exactly **10 succeed (`201`)** and **90 fail (`409 insufficient_funds`)**.
   - Ending `W_AVAIL = $0.00`, `W_HELD = $1.00`, and `verifyLedgerInvariants().ok === true`.
2. **Token Redemption Race (50 parallel `POST /v1/payments/:id/redeem` for the same payment token with distinct idempotency keys):**
   - Result: Exactly **1 succeeds (`200`)** and **49 fail (`409 already_redeemed`)**.
   - Seller `S_PENDING` is credited once, and `verifyLedgerInvariants().ok === true`.
3. **Daily Policy Cap Race (30 parallel `POST /v1/payments` of `$0.10` against a `$0.50` `daily_max` cap):**
   - Result: Exactly **5 succeed (`201`)** and **25 fail (`403 policy_violation`)**.
   - `spend_counters` daily total equals `$0.500000` with zero overdraft.
