# PayPal sandbox setup (M0 runbook)

This is the milestone M0 runbook (SPEC.md sections 2.4, 7.1, 7.2, 8.3, 8.5).
It has two parts: the manual Developer Dashboard checklist, and the smoke test record for `scripts/paypal-smoke.ts`.

## Part 1: Human checklist (PayPal Developer Dashboard, sandbox)

All steps happen at <https://developer.paypal.com> in the **Sandbox** environment.
Record credentials in a local password manager only.
Never commit account emails, passwords, payer IDs, client secrets, or webhook IDs to git.

- [ ] Log in to (or create) a PayPal Developer account.
- [ ] Under **Testing Tools > Sandbox Accounts**, create one **Business** account.
      This account is the Haggles facilitator's PayPal identity and the payout sender.
      Note its email, password, and merchant/payer ID in the password manager.
- [ ] Create two **Personal** sandbox accounts.
      One plays the buyer in the top-up smoke test; the other is a spare / payout recipient.
      Note each email, password, and `payer_id` (visible on the account's detail panel) in the password manager.
- [ ] Under **Apps & Credentials**, create a **REST app** on the Business account.
      Record its sandbox `Client ID` and `Secret`.
- [ ] In the REST app settings, enable **Log in with PayPal**.
- [ ] Set the **Return URL** to `http://localhost:3000/portal/v1/auth/paypal/callback`.
      This is a placeholder until the portal exists.
      The registered Return URL must match the `redirect_uri` sent at runtime exactly (URL-encoded), so update this entry when the real local and deployed URLs are known (SPEC 8.3).
- [ ] In the Log in with PayPal settings, tick the **email** and **profile** attributes.
      The `payer_id` comes from the `https://uri.paypal.com/services/paypalattributes` scope, which the portal requests at authorize time (SPEC 8.3).
      Sandbox apps need no PayPal review; live apps are reviewed and every scope needs approval (risk R2).
- [ ] Register a **webhook** on the REST app.
      The URL can be a placeholder such as `https://example.com/webhooks/paypal` until the API is deployed; update it later.
      Subscribe to these events (SPEC 7.1 step 5 and 7.2):
  - `PAYMENT.CAPTURE.COMPLETED`
  - `PAYMENT.CAPTURE.DENIED`
  - `PAYMENT.CAPTURE.REVERSED`
  - `CHECKOUT.PAYMENT-APPROVAL.REVERSED`
  - all `PAYMENT.PAYOUTSBATCH.*` events
  - all `PAYMENT.PAYOUTS-ITEM.*` events
- [ ] Record the **webhook ID** shown after registration.
      The webhook ID is per environment and is not the client ID; live will need its own (SPEC 8.5).
- [ ] Copy `.env.example` to `.env` at the repo root and fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, and `PAYPAL_SANDBOX_PAYER_ID` (the `payer_id` of the personal account that will receive the $0.01 test payout).
      `.env` is gitignored; never commit it.

## Part 2: Smoke test record

Run each command with `bun scripts/paypal-smoke.ts <command>` (see `scripts/README.md`).
Record the outcome below after every run.
A payout failure is an expected possibility: it selects `sellers.payout_mode = 'simulated'` per SPEC 2.4 (test U1).

| Subcommand | Date | Result | Notes |
|---|---|---|---|
| `token` | 2026-10-21 | **PASS (`OK`)** | Client-credentials OAuth2 token issued (`A21AAJqA...`) and cached in `.paypal-token.json` |
| `order` | - | pending interactive browser approval | Run `bun scripts/paypal-smoke.ts order` or approve via Portal `/buy/wallet` |
| `payout` | 2026-10-21 | **PASS (`SUCCESS`)** | `U1 RESULT: payouts WORK on this sandbox account` (batch `X8B6B4Y9775L8` -> `batch_status=SUCCESS`, `item_status=SUCCESS`, `payout_mode = 'paypal'`) |
| `verify-webhook` | - | pending tunnel / Render URL | Run once webhook URL is registered on Render or tunnel |
