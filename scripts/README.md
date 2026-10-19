# PayPal sandbox smoke script

`paypal-smoke.ts` is the M0 smoke test for the PayPal sandbox (SPEC.md sections 2.4, 7.1, 7.2, 8.5).
Run it with Bun from the repo root:

```sh
bun scripts/paypal-smoke.ts <command>
```

It talks only to `https://api-m.sandbox.paypal.com` and never prints secrets (tokens are masked to 8 characters).
An access token is cached in `.paypal-token.json` at the repo root and reused until 60 seconds before expiry.
That file holds a live bearer token, is written with mode `0600`, and is covered by `.gitignore` (`.paypal-token.json` entry).
Delete it to force a fresh token.

## Environment variables

Copy `.env.example` to `.env` at the repo root and fill in the sandbox values.
The script loads `.env` itself; existing environment variables win.

| Variable | Needed by | Description |
|---|---|---|
| `PAYPAL_CLIENT_ID` | all | Sandbox REST app client ID |
| `PAYPAL_CLIENT_SECRET` | all | Sandbox REST app secret |
| `PAYPAL_WEBHOOK_ID` | `verify-webhook` | Webhook ID from the Developer Dashboard (sandbox only; never the client ID) |
| `PAYPAL_SANDBOX_PAYER_ID` | `payout` | `payer_id` of a sandbox personal account that receives the $0.01 test payout |

## Commands

### `token`

Fetches (or reuses) a client-credentials access token via `POST /v1/oauth2/token` and prints the masked token plus its expiry.

### `order`

Simulates a wallet top-up (SPEC 7.1): creates a $5.00 order with intent `CAPTURE` and `PayPal-Request-Id: smoke-top-<timestamp>`, prints the `approve` link.
Open the link, log in as the sandbox personal (buyer) account, approve, and paste the redirect URL back into the prompt.
The script then captures the order and prints the capture status, capture id, and `paypal_fee` / `net_amount` from `purchase_units[0].payments.captures[0]`.
Exit 0 only when the capture status is `COMPLETED`.

### `payout`

Runs test U1 (SPEC 2.4): submits a $0.01 payout to `PAYPAL_SANDBOX_PAYER_ID` with `sender_batch_id: smoke-hgb-<timestamp>` and `recipient_type: PAYPAL_ID`, then polls `GET /v1/payments/payouts/{batch_id}` every 5 seconds for up to 3 minutes, printing the per-item fee once PayPal reports it.
Prints `U1 RESULT: payouts WORK on this sandbox account` (exit 0) or `U1 RESULT: payouts FAILED - use simulated payout mode (spec 2.4)` (exit 1).

### `verify-webhook [event.json]`

Verifies a captured webhook delivery (SPEC 8.5).
Input is a JSON document `{"headers": {...}, "body": {...}}` exactly as a webhook receiver saw it (the body must be the raw event object; re-serialization can break verification, so capture raw bytes).
Pass a file path or pipe it on stdin:

```sh
bun scripts/paypal-smoke.ts verify-webhook /tmp/event.json
cat /tmp/event.json | bun scripts/paypal-smoke.ts verify-webhook
```

Prints `verification_status` and exits 0 only on `SUCCESS`.
