# Haggles — Product & Engineering Specification

**Status:** v0.3 (decisions locked 2026-10-07: Bun replaces pnpm + Turborepo, AG Grid Community replaces TanStack Table, portal keeps template typography/colors, demo agent uses Gemini via Vertex AI, onrender.com URLs; external PayPal and Render facts verified against official docs on 2026-10-06, see Appendix C) · **License:** MIT · **Primary language:** TypeScript (Node.js 22)
**Audience:** two human developers and one or more AI coding agents building in parallel.

---

## 0. How to use this document

**This spec is the source of truth.** If code and spec disagree, the spec wins until it is changed in a pull request. If the spec is silent or ambiguous, stop and ask. Do not guess, and do not silently invent behaviour.

### 0.1 Conventions

- **MUST / MUST NOT / SHOULD / MAY** have their RFC 2119 meanings.
- **Priority tags:** `P0` = required for the hackathon demo and submission. `P1` = should ship if time allows. `P2` = documented for the future, do not build now.
- **External facts** about PayPal and Render in this spec were checked against their official documentation on 2026-10-06 (sources in Appendix C). Anything that documentation cannot settle is listed in section 2.4 with a concrete acceptance test and a fallback. There are no open `VERIFY` markers.
- **Money** is always USD. On the wire it is a **decimal string** (`"0.02"`). In the database it is an **integer count of micro-dollars** (`bigint`, 1 USD = 1,000,000 micros). Floating point MUST NOT be used for money anywhere.
- **IDs** are prefixed, sortable, and opaque: `acc_`, `wal_`, `agk_` (agent key), `slr_` (seller), `slk_` (seller key), `ep_` (endpoint), `pay_`, `top_` (top-up), `pot_` (payout), `ltx_` (ledger transaction), `chl_` (challenge). Suffix is a ULID.
- **Timestamps** are UTC, ISO 8601 on the wire (`2026-10-06T12:00:00Z`), `timestamptz` in the database.

### 0.2 Rules for AI coding agents working in this repo

These are mirrored in `AGENTS.md` at the repo root.

1. Read this spec section(s) relevant to your task before writing code. Cite the section in your PR description.
2. One task = one small PR. Do not refactor unrelated code.
3. Never change the wire protocol (section 4), the ledger rules (section 6), or the security rules (section 8) without a spec change reviewed by a human.
4. Every exported function, type, and route MUST have TSDoc or an OpenAPI description. Docs are part of "done" (section 13).
5. Every money-moving code path MUST have a test that proves idempotency and ledger balance.
6. Never log secrets, tokens, API keys, or full PayPal payloads.
7. If reality contradicts an external fact in this spec (an API behaves differently from Appendix C), stop and report. Do not work around it silently.

---

## 1. Product overview

### 1.1 One-sentence pitch

**Haggles lets any developer put a price on an HTTP endpoint and get paid in real money (via PayPal) by AI agents that pay automatically, within limits their owners set.**

It is an open protocol (inspired by the HTTP 402 "Payment Required" approach of x402, but settled on PayPal rails instead of crypto), a hosted **facilitator** service, three TypeScript packages, and one web portal.

### 1.2 Problem

- An AI agent that needs a paid data source or piece of content today needs a human to sign up, add a card, copy an API key, and pick a plan. That does not scale to agents that decide at runtime what they need.
- Small sellers (a data collector, a poet, a niche API) rarely build billing, accounts, keys, and plans, so they cannot sell to agents at all.
- Crypto-based per-request payment exists but requires wallets and stablecoins that most sellers, buyers, and companies do not use.

### 1.3 Actors

| Actor | Who | Touches |
|---|---|---|
| **Seller** | Developer or creator who owns content or an API | Portal "Sell" section, `@haggles/server` on their own server |
| **Buyer owner** | Developer or company who runs agents | Portal "Buy" section, `@haggles/client` in their own code |
| **Agent** | Software acting for a buyer owner | Only the SDK and an **agent key**; never the portal |
| **Facilitator** | Haggles backend | Ledger, authorization, settlement, payouts |
| **PayPal** | External | Wallet funding (Orders API), login (OIDC), payouts (Payouts API), webhooks |

One account MAY hold both roles. The portal is a single app with a "Buy" section and a "Sell" section.

### 1.4 What Haggles does NOT do (non-goals for v1)

- **Haggles does not host, schedule, or run agents.** Agents live in the buyer's own code. The SDK is a library.
- No marketplace and no required discovery layer. Discovery (a public directory) is `P2`.
- No crypto, no multi-currency, no on-chain anything.
- No buyer-initiated chargebacks or disputes inside Haggles (`P2`); refunds are issued by sellers (section 4.8).
- No withdrawals of unused wallet balance by the buyer (manual via support in v1; see risk R3).
- No per-end-user sub-wallets for a buyer's own customers. A buyer who builds an app on Haggles funds one wallet and bills their users however they like (`P2` extension).
- No streaming or partial-delivery billing; one HTTP request = one payment.

### 1.5 Success criteria (hackathon)

1. A judge can open a hosted URL, sign in with a PayPal **sandbox** account, fund a wallet through a real sandbox checkout, create an agent key, run the demo agent, and watch it buy from two or three real seller endpoints.
2. A seller account sees earnings accumulate and receives a real PayPal sandbox **payout**.
3. A spending policy visibly **stops** an agent that tries to overspend.
4. A developer can paywall an existing Express or Hono endpoint in **under 5 minutes** by following the docs.
5. All submission requirements in section 16.3 are met.

### 1.6 Glossary

- **Challenge**: the JSON a seller returns with HTTP `402`, describing price and how to pay.
- **Payment token**: a short-lived signed token (JWS) the facilitator issues to the agent after reserving funds.
- **Hold**: funds moved from a wallet's available balance to its held balance while a payment is authorized but not yet redeemed.
- **Redeem / capture**: the seller's server proves a token to the facilitator; the hold becomes a charge and the seller is credited.
- **Receipt**: a facilitator-signed proof that a payment was captured.
- **Policy**: per-agent-key spending limits.

---

## 2. Decisions and assumptions

### 2.1 Decision log

| # | Decision | Why |
|---|---|---|
| D1 | Backend is **Fastify (TypeScript)**, not Python FastAPI. | The project is TypeScript end to end. Shared types and schemas in `@haggles/core` only work if the API is TypeScript too. *If you actually meant Python FastAPI, tell me before implementation starts; it changes the repo structure and removes the shared-type benefits.* |
| D2 | Payment rail is **PayPal** (sandbox for the hackathon), not Stripe. | Hackathon requires PayPal to be central. |
| D3 | **Prepaid wallet + internal ledger.** PayPal is touched only at top-up and payout. | PayPal checkout takes seconds and needs buyer approval, so it cannot run per API call. |
| D4 | **Online redemption only** in v1. The seller's middleware calls the facilitator on every paid request. | Gives exactly-once semantics and avoids replay-cache design. Offline verification is `P2`. |
| D5 | **Fail closed.** If the facilitator is unreachable, the seller's middleware returns `503`, never free content. | Prevents revenue leakage and ambiguous accounting. |
| D6 | **Charge on redeem, refund on seller error.** Middleware auto-refunds if the handler returns `5xx` or throws. | Buyers never pay for failures, with no "settle later" state machine. |
| D7 | **Price is defined in the seller's middleware config** (source of truth). Endpoints appear in the portal automatically on first paid call. | No config sync problem between code and portal. |
| D8 | **Single deployable portal** (Next.js) with Buy and Sell sections. | Less code; shows that any account can be both. |
| D9 | **PostgreSQL is the only source of truth.** Redis (Render Key Value) is used only for rate limiting. Jobs run on `pg-boss` (Postgres). | Minimal infrastructure, strong transactional guarantees. |
| D10 | Wire format is **not** x402-compatible; it is x402-inspired with its own headers. | Avoid claiming compatibility we have not tested. |
| D11 | License **MIT**. | Hackathon needs an open source license visible on the repo. |
| D12 | Package manager and scripts are **Bun** (workspaces + `bun --filter`), not pnpm/Turborepo. | Team standard; the existing portal template is already Bun-based. |
| D13 | Portal data tables use **AG Grid Community** (`ag-grid-react`), not TanStack Table. | Hackathon sponsor prize; AG Grid Community is MIT-licensed. Charts stay on shadcn chart (Recharts); TanStack Query stays for data fetching. |
| D14 | Portal typography and theme keep the existing template: Space Grotesk (UI), Geist Mono (mono), template `--primary` token. | The portal template was already styled to the owner's taste; do not restyle. |
| D15 | Demo agent LLM is **Gemini via Vertex AI** (`@ai-sdk/google-vertex` on the Vercel AI SDK). | Owner's GCP project has Vertex enabled with credits. |
| D16 | No custom domains for the hackathon; default `*.onrender.com` URLs. | Zero cost, zero setup; domains are a post-hackathon concern. |

### 2.2 Assumptions (explicit, so the demo can state them honestly)

| # | Assumption | Consequence |
|---|---|---|
| A1 | PayPal fees make per-call settlement uneconomical, so settlement is batched via the prepaid ledger. | Real money moves only at top-up and payout. Per-call "payments" are ledger entries. This must be stated plainly in the docs and demo. |
| A2 | A PayPal **sandbox business account** can send payouts. | **Confirmed by PayPal's Payouts docs** (sandbox endpoint `api-m.sandbox.paypal.com/v1/payments/payouts`, recipients are sandbox accounts, sender balance must cover total plus fees). Residual risk (account-level enablement) is tested in M0; fallback is `simulated` mode (2.4). |
| A3 | "Log in with PayPal" returns the user's email and, with the `paypalattributes` scope, the `payer_id` that the Payouts API accepts. | **Confirmed by PayPal docs** (scope table and userinfo response). **Sandbox apps need no PayPal review; live apps are reviewed by PayPal** (R2). |
| A4 | Holding customer prepaid balances may trigger money-transmission regulation in a real launch. | v1 imposes small caps (section 7.5), documents the issue (R3), and treats production launch as out of scope for the hackathon. |
| A5 | Agents are server-side Node.js 20+ processes with `fetch`. | Browser-based agents MUST NOT hold agent keys (CORS is disabled on the protocol API). |

### 2.3 Fixed v1 limits (all configurable by env, defaults below)

| Limit | Default |
|---|---|
| Currency | USD only |
| Min price per call | `0.0001` |
| Max price per call | `5.00` |
| Min top-up / max top-up | `5.00` / `200.00` |
| Max wallet balance (available + held) | `500.00` |
| Platform fee | `500` bps (5%), taken from seller side at capture |
| Payout minimum | `1.00` live (`PAYOUT_MIN_MICROS`); the sandbox demo deployment sets `0.10` so a payout is reachable on camera; payout amounts are rounded **down to whole cents** (PayPal's Payouts examples use 2-decimal USD amounts, e.g. `"10.00"`) |
| Hold TTL / token TTL | 120 s / 60 s |
| Refund window | 24 h after capture |

### 2.4 Residual unknowns that documentation cannot settle

Each has a deterministic test (run in M0) and a decided fallback. None blocks starting work.

| # | Unknown | Test (M0) | Fallback decided now |
|---|---|---|---|
| U1 | Whether *your specific* sandbox business account can run a payout end to end (account-level enablement and sandbox balance). | Script `scripts/paypal-smoke.ts` posts a $0.01 payout to a sandbox personal account and waits for `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` (or polls `GET /v1/payments/payouts/{batch_id}`). | `sellers.payout_mode = 'simulated'` for the sandbox deployment; UI shows a permanent "Simulated" badge. Ledger behaviour is identical. |
| U2 | The nonce option name in the pinned `@paypal/react-paypal-js` version (PayPal's SDK accepts a `data-csp-nonce` attribute; the React wrapper's option spelling differs between major versions). | Playwright test loads the Add-funds dialog under the production CSP (8.2) and asserts the PayPal button renders with zero CSP violations. | Pin the exact library version; if the wrapper cannot pass a nonce, load the SDK script in a small custom component that sets both `nonce` and `data-csp-nonce`. |
| U3 | PayPal does not document PKCE for Log in with PayPal. | n/a (decision, not a test) | **Do not use PKCE.** The portal is a *confidential* client (server holds `client_secret`); protection comes from `state` bound to the session, exact `redirect_uri`, TLS, and server-side code exchange (8.3). |

---

## 3. Architecture

### 3.1 Components

```
                         ┌──────────────────────────────┐
                         │  Haggles Portal (Next.js)    │
  Humans ───────────────▶│  Buy section · Sell section  │
                         └───────────────┬──────────────┘
                                         │ same-origin /portal/v1/* (rewrite)
┌──────────────┐  /v1/*   ┌──────────────▼──────────────┐      ┌───────────────┐
│ Agent code   │─────────▶│  Haggles API (Fastify)      │─────▶│ PayPal        │
│ @haggles/    │          │  facilitator + portal API   │◀─────│ Orders/Payouts│
│   client     │          └───────┬───────────┬─────────┘      │ OIDC/Webhooks │
└──────┬───────┘                  │           │                └───────────────┘
       │ HTTP 402 flow            ▼           ▼
       ▼               ┌──────────────┐  ┌───────────┐   ┌───────────────────┐
┌──────────────┐       │ PostgreSQL 16│  │ Redis     │   │ Worker (same img) │
│ Seller server│       │ ledger, data │  │ rate limit│   │ pg-boss jobs      │
│ @haggles/    │──────▶│ jobs         │◀─┴───────────┘   └───────────────────┘
│   server     │ /v1/redeem
└──────────────┘
```

### 3.2 Deployables

| Deployable | Type on Render | Notes |
|---|---|---|
| `apps/api` | Web service (Docker) | Fastify. Serves protocol API (`/v1/*`), portal API (`/portal/v1/*`), webhooks. |
| `apps/worker` | Background worker (Docker, same image as API, different command) | `pg-boss` jobs. |
| `apps/portal` | Web service (Docker) | Next.js (App Router). Proxies `/portal/v1/*` to the API over Render's private network. |
| `apps/docs` | Static site | Astro Starlight. |
| `examples/seller-datasets` | Web service | Demo seller, Hono. |
| `examples/seller-poems` | Web service | Demo seller, Express. |
| `examples/buyer-research-agent` | Web service | Demo buyer app with an LLM agent. |
| Postgres 16 | Render managed database | |
| Key Value (Redis-compatible) | Render managed | Rate limiting only. |

### 3.3 Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5.x `strict`, ESM |
| Monorepo | Bun workspaces + `bun --filter` scripts |
| API framework | Fastify 5 with `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/under-pressure` |
| Validation / OpenAPI | TypeBox schemas on every route; OpenAPI 3.1 generated from them and committed as `openapi.json` |
| DB access | Drizzle ORM + `postgres` (postgres.js) driver; migrations with `drizzle-kit` |
| Jobs | `pg-boss` |
| JWT/JWS | `jose` (EdDSA / Ed25519) |
| Logging | `pino`, JSON, with redaction |
| Portal | Next.js (App Router), React, **shadcn/ui** + Tailwind CSS, shadcn `chart` (Recharts), AG Grid Community (ag-grid-react), TanStack Query, React Hook Form + Zod, `sonner` toasts, `@paypal/react-paypal-js` |
| Typed API client for portal | `openapi-typescript` + `openapi-fetch`, generated from `openapi.json` |
| Docs | Astro Starlight, TypeDoc for SDK reference, OpenAPI reference from `openapi.json` |
| Tests | Vitest, Testcontainers (Postgres), fast-check, Playwright, k6 |
| Lint/format | ESLint (typescript-eslint strict), Prettier |
| SDK builds | `tsup` (dual ESM + CJS, `.d.ts`) |

### 3.4 Repository layout

```
haggles/
├─ AGENTS.md                 # rules for AI agents (mirrors section 0.2)
├─ README.md                 # 5-minute quickstart, architecture summary, links
├─ LICENSE                   # MIT
├─ SPEC.md                   # this document
├─ CONTRIBUTING.md  SECURITY.md  CHANGELOG.md
├─ openapi.json              # generated, committed, checked in CI
├─ render.yaml               # Render Blueprint (section 14.3)
├─ docker-compose.yml        # local Postgres + Redis (+ optional full stack)
├─ tsconfig.base.json            # Bun workspaces are declared in root package.json
├─ apps/
│  ├─ api/                   # Fastify: src/{routes,services,db,ledger,paypal,jobs,plugins}
│  ├─ worker/                # entrypoint importing apps/api jobs
│  ├─ portal/                # Next.js
│  └─ docs/                  # Starlight
├─ packages/
│  ├─ core/                  # @haggles/core
│  ├─ client/                # @haggles/client
│  ├─ server/                # @haggles/server
│  └─ mcp/                   # @haggles/mcp (P1)
└─ examples/
   ├─ seller-datasets/  seller-poems/  buyer-research-agent/
```

Dependency rule: `core` depends on nothing in the repo. `client` and `server` depend only on `core`. `apps/api` depends on `core`. `apps/portal` depends on the generated API client only (never on `apps/api` code).


---

## 4. The Haggles protocol (wire specification)

This section is normative. `@haggles/core` MUST implement it exactly and ship the test vectors in `packages/core/test-vectors/`.

### 4.1 Headers

| Header | Direction | Value |
|---|---|---|
| `Haggles-Payment-Required` | Seller → agent, on `402` | `base64url(UTF-8 JSON)` of the **challenge** |
| `Haggles-Payment` | Agent → seller, on retry | Payment token (JWS compact string) |
| `Haggles-Receipt` | Seller → agent, on `200` | Receipt (JWS compact string) |

The `402` response body MUST also contain the challenge as plain JSON (`Content-Type: application/json`) for humans and debugging. Agents MUST read the header first and MAY fall back to the body.

### 4.2 Challenge

```json
{
  "protocol": "haggles",
  "version": 1,
  "scheme": "prepaid-usd",
  "challenge_id": "chl_01J9Z3...",
  "amount": "0.02",
  "currency": "USD",
  "method": "GET",
  "url": "https://poems.example.com/poems/42",
  "seller_id": "slr_01J9Y8...",
  "description": "One poem from the collection",
  "facilitator": "https://api.haggles.example.com",
  "expires_at": "2026-10-06T12:01:00Z"
}
```

Rules:
- `amount` matches `^\d{1,7}(\.\d{1,6})?$` and is within the min/max price limits.
- `challenge_id` is random (ULID) per `402`, generated by the seller middleware.
- `url` is the **canonical URL** (4.3) of the request as seen by the public internet.
- `expires_at` is 60 seconds after issuance. It is advisory for the agent; enforcement happens via token expiry.
- Unknown fields MUST be ignored by clients. `version` is bumped only for breaking changes.

### 4.3 Canonical URL

`canonicalizeUrl(input: string): string` in `@haggles/core`:
1. Parse with the WHATWG `URL` parser.
2. Lowercase scheme and host; strip default ports (80 for http, 443 for https).
3. Remove the fragment.
4. Normalize percent-encoding to uppercase hex; do not decode reserved characters.
5. Keep path and **query string exactly as received** (no sorting).

The seller middleware computes `url = canonicalizeUrl(publicBaseUrl + originalPathAndQuery)`. `publicBaseUrl` is a **required** middleware option so that proxies and load balancers cannot change the host or scheme.

The client MUST verify `canonicalizeUrl(challenge.url) === canonicalizeUrl(response.url)` (the final URL after redirects) and `challenge.method` equals the request method. On mismatch it MUST NOT pay and MUST throw `ChallengeMismatchError`.

### 4.4 Payment token (JWS, EdDSA/Ed25519)

Header: `{"alg":"EdDSA","typ":"haggles-payment+jwt","kid":"<key id>"}`

Claims:

| Claim | Meaning |
|---|---|
| `iss` | Facilitator base URL |
| `aud` | `seller_id` (only that seller may redeem it) |
| `sub` | Payment ID `pay_...` |
| `iat`, `exp` | Issued at; expiry = `iat + 60s` |
| `amount`, `currency` | Exactly as authorized |
| `method`, `url` | Canonical request the token is valid for |
| `chl` | The `challenge_id` |

The token MUST NOT contain buyer identity (no account, wallet, or key IDs).

### 4.5 Receipt (JWS, EdDSA)

Header `typ`: `haggles-receipt+jwt`. Claims: `iss`, `sub` (payment ID), `aud` (seller_id), `iat`, `amount`, `currency`, `method`, `url`, `captured_at`. Signed with the same facilitator keys. The agent MAY store it as proof of payment. Receipts are verifiable offline using the JWKS.

### 4.6 Signing keys and JWKS

- Facilitator signs with Ed25519 keys stored in the `signing_keys` table, private key encrypted with AES-256-GCM using `MASTER_KEY` (envelope encryption).
- Public keys are published at `GET /.well-known/jwks.json` with `Cache-Control: public, max-age=300`.
- Rotation: a new key becomes active monthly (`P1`; manual rotation is `P0`). Retired keys stay published for 24 hours after last use.

### 4.7 Full flow

```mermaid
sequenceDiagram
  participant A as Agent (@haggles/client)
  participant S as Seller server (@haggles/server)
  participant F as Facilitator (Haggles API)
  A->>S: GET /poems/42
  S-->>A: 402 + Haggles-Payment-Required (challenge)
  A->>A: validate challenge (url, price guard)
  A->>F: POST /v1/payments {challenge}  (Bearer agent key)
  F->>F: check key, policy, balance; HOLD funds
  F-->>A: 201 {payment_id, token}
  A->>S: GET /poems/42 + Haggles-Payment: token
  S->>S: verify JWS locally (sig, aud, exp, url, amount)
  S->>F: POST /v1/payments/{id}/redeem  (Bearer seller key)
  F->>F: atomically authorized → captured; credit seller
  F-->>S: 200 {captured, receipt}
  S->>S: run handler
  S-->>A: 200 content + Haggles-Receipt
```

Exactly **one payment per call**: if the retried request returns `402` again, the client throws `PaymentNotAcceptedError` and does not pay again.

### 4.8 Payment state machine

```
          POST /v1/payments                 redeem                refund (seller, ≤24h)
(none) ───────────────────▶ authorized ───────────────▶ captured ───────────────────▶ refunded
                                │  token/hold expired
                                └────────────────────▶ released
```

- `released` and `refunded` are terminal. Partial refunds are not supported in v1.
- Transitions are single atomic SQL updates guarded by the current status (`UPDATE ... WHERE status = 'authorized' RETURNING ...`). No read-then-write.
- The worker releases `authorized` payments whose `expires_at` has passed (runs every 15 s; also enforced lazily at redeem time).

### 4.9 Client rules (`@haggles/client`)

1. Send the original request unchanged. If the status is not `402`, return the response untouched.
2. If `402` but no valid `Haggles-Payment-Required` (header or body) with `protocol: "haggles"`, return the `402` response untouched (it is some other 402).
3. Validate: version supported; currency `USD`; `canonicalizeUrl`/method match (4.3); `amount` ≤ the client-side `maxPricePerCall` guard if configured.
4. Call `POST /v1/payments` with header `Idempotency-Key: <challenge_id>`.
5. Retry the original request **once** with `Haggles-Payment: <token>`. The request body MUST be replayable (string, `Uint8Array`, `URLSearchParams`, or none). For stream bodies the client MUST throw `NonReplayableBodyError` before paying, unless the option `bufferBody: true` is set.
6. Surface the receipt via `readReceipt(response)`.
7. Never follow a `402` more than once per call; never pay for the same `challenge_id` twice (idempotency covers retries after network errors).

### 4.10 Seller rules (`@haggles/server`)

1. No `Haggles-Payment` header → respond `402` with a fresh challenge (4.2).
2. Header present → verify locally: signature via cached JWKS (refresh on unknown `kid`, at most once per 10 s), `typ`, `iss` equals configured facilitator, `aud` equals own `seller_id`, `exp` in the future, `method` and `url` equal this request's canonical values, `amount` equals the route price. Any failure → fresh `402` (never a `500`).
3. Call `POST /v1/payments/{id}/redeem` with timeout 2 s and one retry using the **same** `Idempotency-Key`.
   - `200` → continue. `409 already_redeemed` → fresh `402`. `409 amount_mismatch` → fresh `402`. `404/410` → fresh `402`.
   - Network error or `5xx` after retry → `503` with `Retry-After: 2`. **Never serve content unpaid** (D5).
4. Run the handler. Set `Haggles-Receipt` on the response.
5. If the handler throws or returns status `>= 500` and `refundOnError` is true (default), call `POST /v1/payments/{id}/refund` asynchronously (fire-and-forget with retry via an in-process queue; failures logged with the payment ID).
6. Middleware MUST NOT log the token or receipt.

### 4.11 Error format

All facilitator errors use RFC 9457 `application/problem+json`:

```json
{
  "type": "https://docs.haggles.example.com/errors/insufficient_funds",
  "title": "Insufficient funds",
  "status": 409,
  "code": "insufficient_funds",
  "detail": "Available balance 0.01 is less than 0.02.",
  "request_id": "req_01J..."
}
```

Error code catalogue is in Appendix A.

---

## 5. API reference

All IDs are strings. All request/response bodies are JSON. Every route has a TypeBox schema; OpenAPI is generated. Pagination is cursor-based: `?limit=50&cursor=<opaque>` (max limit 100), responses `{ "data": [...], "next_cursor": "..." | null }`.

### 5.1 Protocol API (`/v1/*`, used by SDKs)

Auth: `Authorization: Bearer <key>`. Agent keys start `hgk_`, seller keys start `hgs_`. No cookies. CORS is **disabled**.

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /v1/payments` | Agent key | Authorize a payment (policy check + hold) and return token. Header `Idempotency-Key` required. |
| `GET /v1/payments/{id}` | Agent key (own) or Seller key (own) | Read a payment. Sellers see a pseudonymous `agent_ref`, never buyer identity. |
| `POST /v1/payments/{id}/redeem` | Seller key | Capture. Header `Idempotency-Key` required. |
| `POST /v1/payments/{id}/refund` | Seller key | Refund a captured payment (≤24 h). |
| `GET /v1/wallet` | Agent key | Available, held, and remaining policy allowance. |
| `GET /.well-known/jwks.json` | None | Public signing keys. |
| `GET /health` | None | Liveness (process up). |
| `GET /ready` | None | Readiness (DB reachable, migrations current). |

**`POST /v1/payments`**
Request: `{ "challenge": { ...full challenge object... } }`
Success `201`: `{ "payment_id": "pay_...", "token": "<jws>", "amount": "0.02", "currency": "USD", "expires_at": "..." }`
Steps, all in **one DB transaction**:
1. Resolve agent key by prefix + HMAC compare; reject revoked/expired keys.
2. Validate challenge (schema, version, currency, price limits, `expires_at` not wildly in the past, `seller_id` exists and is `active`).
3. Idempotency: if `(agent_key_id, Idempotency-Key)` exists, return the stored response (same token).
4. Policy checks (5.3) including atomic spend-counter increment.
5. Atomic balance move `wallet_available → wallet_held` guarded by `balance >= amount` (single `UPDATE ... RETURNING`).
6. Insert `payments` row (`authorized`) and ledger transaction `HOLD`.
7. Sign token; commit; return.

Failure codes: `invalid_challenge` (422), `seller_not_found` (404), `policy_violation` (403, with `detail` naming which limit), `insufficient_funds` (409), `key_revoked` (401), `rate_limited` (429).

**`POST /v1/payments/{id}/redeem`**
Request: `{ "token": "<jws>", "method": "GET", "url": "<canonical>", "amount": "0.02", "route": "/poems/:id" }`. `route` is the framework route pattern (adapters fill it automatically; optional, max 200 chars) and is used only to group calls into endpoints.
Success `200`: `{ "payment_id", "status": "captured", "amount", "seller_net", "receipt": "<jws>" }`
Rules: the seller key's seller MUST equal the payment's seller; token signature and `exp` verified again server-side; `method`/`url`/`amount` MUST equal the stored values else `409 amount_mismatch` (or `409 request_mismatch`); transition `authorized → captured` is a single guarded update. A repeat call with the **same** `Idempotency-Key` returns the original `200`; with a different key returns `409 already_redeemed`.

**`POST /v1/payments/{id}/refund`**
Request: `{ "reason": "handler_error" | "seller_initiated" }`. Allowed only for `captured` payments within 24 h. Posts the `REFUND` ledger transaction (6.3). Idempotent by payment ID.

### 5.2 Portal API (`/portal/v1/*`, used only by the portal)

Auth: session cookie. All state-changing requests require CSRF header (8.3). Every query is scoped by `account_id` from the session.

| Area | Endpoints |
|---|---|
| Auth | `GET /auth/paypal/start`, `GET /auth/paypal/callback`, `POST /auth/logout`, `GET /me`, `PATCH /me` (roles, display name) |
| Buyer | `GET /buyer/summary`, `GET /buyer/spend-series?days=30`, `GET /buyer/keys`, `POST /buyer/keys`, `GET /buyer/keys/{id}`, `PATCH /buyer/keys/{id}` (name, policy), `POST /buyer/keys/{id}/revoke`, `GET /buyer/payments?key=&seller=&status=&from=&to=`, `GET /buyer/payments/{id}` |
| Wallet | `GET /buyer/topups`, `POST /buyer/topups` (creates PayPal order), `POST /buyer/topups/{id}/capture` |
| Seller | `GET /seller/summary`, `GET /seller/revenue-series?days=30`, `GET /seller/endpoints`, `PATCH /seller/endpoints/{id}` (display name, description, status), `GET /seller/keys`, `POST /seller/keys`, `POST /seller/keys/{id}/revoke`, `GET /seller/calls`, `GET /seller/payouts`, `POST /seller/payouts` (request now), `POST /seller/test-key` (P1, sandbox only) |
| Webhooks | `POST /webhooks/paypal` (public, signature-verified; not under `/portal`) |

### 5.3 Policy enforcement

An agent key's policy fields:

| Field | Type | Default on creation |
|---|---|---|
| `per_call_max` | money | `0.10` |
| `daily_max` | money (UTC day) | `5.00` |
| `monthly_max` | money or null (UTC month) | null |
| `allowed_sellers` | list of `slr_` IDs or null | null (any) |
| `allowed_hosts` | list of hostnames or null | null (any) |
| `expires_at` | timestamp or null | null |

Spend counters count `authorized + captured`, minus `released` and `refunded`. The day/month of a payment is the UTC date of its **authorization**. The counter row is incremented in the same transaction as the hold using `INSERT ... ON CONFLICT DO UPDATE ... WHERE spent + $amount <= $cap RETURNING`; zero rows returned means the cap would be exceeded. Releases and refunds decrement the same counter row.

---

## 6. Data model and ledger

### 6.1 Tables (PostgreSQL 16)

All tables have `created_at timestamptz not null default now()`. Money columns are `bigint` micros with `CHECK (>= 0)` unless stated. All foreign keys are enforced.

| Table | Key columns |
|---|---|
| `accounts` | `id acc_`, `paypal_payer_id` (not null, unique; from `payer_id` in userinfo), `paypal_user_id` (not null, unique; the `sub`/`user_id` URL), `email` (primary confirmed email from userinfo, unique), `paypal_verified_account bool`, `display_name`, `is_buyer bool`, `is_seller bool`, `status` (`active`,`frozen`) |
| `sessions` | `id`, `account_id`, `token_hash` (SHA-256, unique), `expires_at`, `absolute_expires_at`, `user_agent`, `ip` |
| `wallets` | `id wal_`, `account_id` (unique), `status` |
| `agent_keys` | `id agk_`, `wallet_id`, `name`, `prefix` (unique), `key_hash`, policy columns (5.3), `status` (`active`,`revoked`), `last_used_at`, `revoked_at` |
| `agent_key_spend` | PK (`agent_key_id`, `period_kind` (`day`,`month`), `period_start date`), `spent_micros` |
| `sellers` | `id slr_`, `account_id` (unique), `status` (`active`,`paused`), `payout_paypal_payer_id`, `payout_email`, `payout_mode` (`paypal`,`simulated`) |
| `seller_keys` | `id slk_`, `seller_id`, `name`, `prefix` (unique), `key_hash`, `status`, `last_used_at`. Max 2 active per seller. |
| `endpoints` | `id ep_`, `seller_id`, `method`, `route` (the `route` value sent at redeem; falls back to the URL path with query stripped), `display_name`, `description`, `last_price_micros`, `status` (`active`,`hidden`). Unique (`seller_id`,`method`,`route`). Upserted on capture. |
| `payments` | `id pay_`, `wallet_id`, `agent_key_id`, `seller_id`, `endpoint_id`, `amount_micros`, `fee_micros`, `method`, `url`, `challenge_id`, `status` (`authorized`,`captured`,`released`,`refunded`), `authorized_at`, `expires_at`, `captured_at`, `released_at`, `refunded_at`, `idempotency_key`, `redeem_idempotency_key`, `response_status int null`. Unique (`agent_key_id`,`idempotency_key`). Indexes: (`seller_id`,`created_at desc`), (`wallet_id`,`created_at desc`), partial (`expires_at`) where `status='authorized'`. |
| `topups` | `id top_`, `wallet_id`, `amount_micros`, `paypal_order_id` (unique), `paypal_capture_id` (unique nullable), `paypal_fee_micros`, `paypal_net_micros`, `status` (`created`,`pending`,`credited`,`failed`,`reversed`) |
| `payouts` | `id pot_`, `seller_id`, `amount_micros`, `batch_ref` (our `sender_batch_id`, `hgb_...`), `paypal_batch_id`, `paypal_item_id`, `paypal_fee_micros` (null until known), `status` (`pending`,`processing`,`succeeded`,`failed`,`reversed`), `mode` (`paypal`,`simulated`), `failure_reason`, `requested_by` (`schedule`,`seller`) |
| `ledger_accounts` | `id`, `kind` (6.2), `owner_id` (nullable), `balance_micros bigint` (signed; see 6.2 for CHECKs), `version` |
| `ledger_transactions` | `id ltx_`, `kind`, `reference_type`, `reference_id`, `created_at` |
| `ledger_entries` | `id`, `transaction_id`, `ledger_account_id`, `direction` (`debit`,`credit`), `amount_micros > 0` |
| `signing_keys` | `kid`, `public_jwk`, `private_enc` (AES-GCM blob), `status` (`active`,`retired`), `created_at`, `retired_at` |
| `webhook_events` | `paypal_event_id` (unique), `event_type`, `received_at`, `processed_at`, `payload` (jsonb; scrubbed of nothing secret) |
| `audit_log` | `id`, `account_id`, `action`, `target_type`, `target_id`, `ip`, `meta jsonb` (never secrets) |

### 6.2 Ledger

Double-entry bookkeeping. Every `ledger_transaction` MUST have entries whose debits equal its credits. This is enforced by a deferred constraint trigger and by application tests.

Convention: `balance = credits − debits` for liability/revenue accounts, `balance = debits − credits` for asset/expense accounts. `ledger_accounts.balance_micros` is a **materialized, transactionally maintained** value; `ledger_entries` are the source of truth. A nightly job recomputes balances from entries and alerts on any difference.

| Account kind | Per | Type | Meaning | Constraint |
|---|---|---|---|---|
| `W_AVAIL` | wallet | liability | Spendable buyer funds | `>= 0` |
| `W_HELD` | wallet | liability | Funds reserved by authorized payments | `>= 0` |
| `S_PENDING` | seller | liability | Earned, not yet paid out | may go negative **only** via refunds |
| `S_PAYOUT` | seller | liability | In-flight payouts | `>= 0` |
| `G_PAYPAL` | global | asset | Money in the PayPal business account | none |
| `G_FEES` | global | revenue | Haggles platform fees | none |
| `G_PAYPAL_FEES` | global | expense | PayPal costs (funding, payouts) | none |

### 6.3 Postings (the only allowed ledger transactions)

`P` = payment amount, `f` = platform fee = `floor(P × PLATFORM_FEE_BPS / 10000)`, `A` = top-up amount, `F` = PayPal fee on top-up, `X` = payout amount, `x` = PayPal payout fee.

| # | Kind | Debits | Credits |
|---|---|---|---|
| 1 | `TOPUP` | `G_PAYPAL` (A−F), `G_PAYPAL_FEES` (F) | `W_AVAIL` (A) |
| 2 | `HOLD` | `W_AVAIL` (P) | `W_HELD` (P) |
| 3 | `RELEASE` | `W_HELD` (P) | `W_AVAIL` (P) |
| 4 | `CAPTURE` | `W_HELD` (P) | `S_PENDING` (P−f), `G_FEES` (f) |
| 5 | `REFUND` | `S_PENDING` (P−f), `G_FEES` (f) | `W_AVAIL` (P) |
| 6 | `PAYOUT_START` | `S_PENDING` (X) | `S_PAYOUT` (X) |
| 7 | `PAYOUT_DONE` | `S_PAYOUT` (X) | `G_PAYPAL` (X) |
| 7b | `PAYOUT_FEE` (posted once the item fee is known; PayPal charges the sender) | `G_PAYPAL_FEES` (x) | `G_PAYPAL` (x) |
| 8 | `PAYOUT_FAIL` | `S_PAYOUT` (X) | `S_PENDING` (X) |
| 9 | `PAYOUT_REVERSED` (item returned/refunded **after** success) | `G_PAYPAL` (X) | `S_PENDING` (X) |

Rules:
- Each posting happens in the **same DB transaction** as the state change that causes it (e.g. payment status update).
- Postings are idempotent by `(reference_type, reference_id, kind)` unique index.
- Account balance updates use `UPDATE ledger_accounts SET balance_micros = balance_micros ± $x, version = version + 1 WHERE id = $id [AND balance_micros >= $x] RETURNING ...`. Lock ordering: always lock accounts in ascending `id` order to avoid deadlocks.
- A `REFUND` that makes `S_PENDING` negative is allowed; that seller's future payouts are reduced until it is non-negative again. Payouts are only initiated when `S_PENDING >= PAYOUT_MIN`.

---

## 7. Money flows with PayPal

### 7.1 Wallet top-up (Orders API v2)

Base URLs: sandbox `https://api-m.sandbox.paypal.com`, live `https://api-m.paypal.com`. The server authenticates with OAuth2 client credentials (`POST /v1/oauth2/token`); access tokens last roughly 9 hours, so the gateway caches the token and refreshes it before expiry or on a `401`. Every PayPal POST sets a `PayPal-Request-Id` header (without it PayPal treats each call as a new operation).

1. Portal "Add funds" dialog → `POST /portal/v1/buyer/topups {amount}`. Server validates limits (2.3, including max wallet balance), inserts a `topups` row (`created`), and calls `POST /v2/checkout/orders` with `intent: "CAPTURE"`, one purchase unit in USD, `custom_id = top_<ULID>`, `PayPal-Request-Id = top_<ULID>`. Returns `{ order_id }`.
2. `PayPalButtons` (from `@paypal/react-paypal-js`) approve the order in the buyer's browser.
3. Portal calls `POST /portal/v1/buyer/topups/{id}/capture`. Server calls `POST /v2/checkout/orders/{order_id}/capture` (same `PayPal-Request-Id` discipline). The capture lives at `purchase_units[0].payments.captures[0]`; its `status`, `id`, and `seller_receivable_breakdown.paypal_fee` / `.net_amount` are stored in `paypal_capture_id`, `paypal_fee_micros`, `paypal_net_micros`.
4. **Credit rule:** the wallet is credited only when the capture `status` is `COMPLETED`, verified from PayPal's response or from a re-fetch, never from the browser. If the status is `PENDING`, the top-up becomes `pending` and waits for the webhook. Any other final status (`DECLINED`, `FAILED`) marks it `failed`. Credit via either path (capture response or webhook `PAYMENT.CAPTURE.COMPLETED`) is idempotent through the unique `TOPUP` posting key.
5. Webhook events subscribed: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REVERSED`, `CHECKOUT.PAYMENT-APPROVAL.REVERSED`, plus the payout events in 7.2.
6. Stuck `created`/`pending` top-ups older than 1 hour are reconciled by a job that fetches the order from PayPal.
7. `PAYMENT.CAPTURE.DENIED` → top-up `failed`. `PAYMENT.CAPTURE.REVERSED` → top-up `reversed`, wallet `frozen`, audit event, manual review (automated clawback is `P2`).

### 7.2 Seller payouts (Payouts API)

Endpoint: `POST /v1/payments/payouts` (v1). Facts from PayPal's docs that shape the design:
- The **sender account (Haggles' PayPal business account) must hold enough balance to cover the payout total including fees.** Payout fees are therefore a Haggles cost, posted as `PAYOUT_FEE` (posting 7b). PayPal reports the fee per item once the item reaches the pending state; read it from *Show payout batch details* (`GET /v1/payments/payouts/{batch_id}`) and never hard-code it. Because a fee is charged per item, tiny payouts are uneconomical, which is why payouts are batched and have a minimum.
- A batch holds up to 15,000 items per call.
- **`sender_batch_id` is an idempotency key for 30 days:** reusing one is rejected with an error that includes a link to the original payout. We exploit this for crash recovery (below).
- Recipient types are `EMAIL`, `PHONE`, `USER_HANDLE`, `PAYPAL_ID`. **We always use `PAYPAL_ID` with the seller's `payer_id`** from login (A3), so the recipient is guaranteed to hold a PayPal account and the item cannot become `UNCLAIMED`.
- Amounts are strings with two decimals (`"9.87"`).

Flow:
1. Seller identity comes from login (`payer_id`). `sellers.payout_mode` is `paypal`, or `simulated` if test U1 failed.
2. A weekly job (Monday 00:00 UTC) and the on-demand "Request payout" button (max 1 per hour per seller) select each seller with `S_PENDING >= PAYOUT_MIN`. `X = floor_to_cents(S_PENDING)`; the sub-cent remainder stays pending.
3. In one transaction per seller: insert `payouts` row (`pending`, `batch_ref = hgb_<ULID of the run>`), post `PAYOUT_START`.
4. The worker submits one PayPal batch per run: `sender_batch_header: { sender_batch_id: batch_ref, recipient_type: "PAYPAL_ID", email_subject: "Your Haggles earnings" }`, one item per payout with `receiver = payer_id`, `amount: { value, currency: "USD" }`, `sender_item_id = pot_...`. **`batch_ref` is persisted before the call.** If the process dies after the call, the retry hits the duplicate-`sender_batch_id` rejection, follows the link to the original batch, and adopts its `payout_batch_id` instead of paying twice. Payouts move to `processing`.
5. Completion arrives by webhook, with `GET /v1/payments/payouts/{batch_id}` polling as a fallback every 5 minutes for `processing` payouts. Verified event names and our handling:

| PayPal event | Meaning (per PayPal) | Our action |
|---|---|---|
| `PAYMENT.PAYOUTSBATCH.PROCESSING` / `.SUCCESS` / `.DENIED` | Batch-level state; **contains no item information** | Log only. Item events drive the ledger. Batch `DENIED` → fetch batch details and fail all `processing` items in it. |
| `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` | Funds credited to recipient. PayPal advises confirming via item details that `transaction_status == SUCCESS` | Fetch item details, confirm, then `PAYOUT_DONE` (+ `PAYOUT_FEE` from the item's fee). Status `succeeded`. |
| `PAYMENT.PAYOUTS-ITEM.FAILED`, `.DENIED`, `.BLOCKED`, `.CANCELED` | Item failed, rejected, blocked by risk/compliance, or canceled | `PAYOUT_FAIL`. Status `failed` with `failure_reason`. Funds return to `S_PENDING`. |
| `PAYMENT.PAYOUTS-ITEM.HELD` | Temporarily held for verification | Stay `processing`; alert if still held after 7 days. |
| `PAYMENT.PAYOUTS-ITEM.UNCLAIMED` | Recipient has not claimed (cannot happen with `PAYPAL_ID`, handled defensively) | Stay `processing`; treat a later `RETURNED` as failure. |
| `PAYMENT.PAYOUTS-ITEM.RETURNED`, `.REFUNDED` | Funds returned or refunded to the sender | If the payout was still `processing`: `PAYOUT_FAIL`. If already `succeeded`: post `PAYOUT_REVERSED` (posting 9), status `reversed`. |

6. In `simulated` mode, steps 4-5 are skipped and the payout is marked `succeeded` after 10 seconds. The portal shows a **"Simulated"** badge. This must never be hidden.

### 7.3 Fees

- **PayPal fees** are recorded, never hard-coded. The spec makes no claim about their size; read them from the API responses.
- **Platform fee:** `PLATFORM_FEE_BPS` (default 500). Taken from the seller's side at capture (posting 4). Visible in the seller portal per payment as "Fee" and "Net".

### 7.4 Refunds

Seller-initiated only (v1). Returns funds to the buyer's `W_AVAIL` (not to PayPal). Platform fee on the refunded payment is also returned. Rationale: the buyer already holds a credit in Haggles; no PayPal fee is spent.

### 7.5 Risk limits

Caps in 2.3 exist to bound exposure while holding prepaid funds. They are enforced in services, not just UI.

---

## 8. Security requirements

Security is a first-class feature. Every item below is `P0` unless marked.

### 8.1 Secrets and keys

- API keys: `hgk_<env>_<43 base64url chars>` (agent) and `hgs_<env>_<43 chars>` (seller), generated with `crypto.randomBytes(32)`. `<env>` is `test` or `live`.
- Store only `prefix` (first 16 chars of full key) and `key_hash = HMAC-SHA256(KEY_PEPPER, fullKey)`. Lookup by prefix, compare with `timingSafeEqual`. The full key is shown **once** at creation.
- `MASTER_KEY` (32 random bytes, base64) encrypts signing private keys. `KEY_PEPPER` (32 random bytes) is used for API key hashing. Both live only in Render environment groups, never in the repo or logs.
- Production secrets MUST differ from test secrets. `test` keys MUST be rejected by a `live` deployment and vice versa.

### 8.2 Transport and headers

- HTTPS only (Render terminates TLS). `Strict-Transport-Security` (1 year, includeSubDomains) via Helmet.
- Portal sends a **CSP** built from PayPal's published JS SDK guidance (PayPal requires `*.paypal.com` and `*.paypalobjects.com`, plus `*.venmo.com` because the button can silently fail to render without it when Venmo is offered). A per-response nonce replaces `'unsafe-inline'` for scripts:

  ```
  default-src 'self';
  script-src  'self' 'nonce-<N>' https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com;
  connect-src 'self' https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com;
  frame-src   https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com;
  child-src   https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com;
  img-src     'self' data: https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com;
  font-src    'self' https://*.paypalobjects.com;
  style-src   'self' 'unsafe-inline' https://*.paypal.com https://*.paypalobjects.com;
  object-src 'none'; base-uri 'self'; frame-ancestors 'none';
  ```

  `style-src 'unsafe-inline'` is a deliberate, documented exception (Tailwind/shadcn and Recharts emit inline style attributes; PayPal's own guidance also lists it for styles). No `unsafe-eval`. The PayPal SDK `<script>` MUST carry both `nonce` and `data-csp-nonce` set to `<N>` (PayPal documents `data-csp-nonce` as separate from the standard attribute). See U2 for the test.
- API disables CORS entirely for `/v1/*` and `/webhooks/*`. Portal API is same-origin through the portal's rewrite; no CORS needed.
- Request body limit 64 KB; request timeout 5 s; JSON only.

### 8.3 Sessions and CSRF (portal)

- **Log in with PayPal (authorization code flow, confidential client).**
  - Dashboard setup (M0): in the REST app, enable *Log in with PayPal*, set the **Return URL** (must match the `redirect_uri` we send exactly, URL-encoded), and tick the needed attributes. Sandbox apps need **no PayPal review**; live apps are submitted for review automatically when you save and **all scopes require PayPal's approval** (R2). Live also needs privacy-policy and user-agreement URLs.
  - Authorize: redirect to `https://www.sandbox.paypal.com/signin/authorize?flowEntry=static&client_id=…&response_type=code&scope=openid%20profile%20email%20https%3A%2F%2Furi.paypal.com%2Fservices%2Fpaypalattributes&redirect_uri=…&state=…` (live host: `www.paypal.com`).
  - Callback: verify `state` equals the value stored with the pre-login cookie, then exchange the `code` server-side with `POST /v1/oauth2/token` (HTTP Basic with client ID and secret, `grant_type=authorization_code`).
  - Identity: call `GET /v1/identity/oauth2/userinfo?schema=paypalv1.1` with the user access token. Use `payer_id` (stable account key and payout recipient), `user_id`/`sub` (stored as `paypal_user_id`), the **primary confirmed** entry of `emails`, and `verified_account`. The ID token is not used.
  - Live seller payouts additionally require `verified_account = true` (`P1`); the sandbox does not.
  - **PKCE is not used** (U3). `nonce` is not needed because no ID token is consumed.
- Session cookie `hg_session`: opaque 256-bit random, only its SHA-256 stored; `HttpOnly; Secure; SameSite=Lax; Path=/`; 7-day sliding, 30-day absolute expiry; rotated on login; invalidated on logout.
- CSRF: double-submit token. Cookie `hg_csrf` (readable by JS) must equal header `X-Haggles-CSRF` on every non-GET request. Additionally check `Origin` equals the portal origin.

### 8.4 Authorization

- Every portal route derives `account_id` from the session and scopes all queries by it. Direct object references (`/buyer/keys/{id}`) MUST verify ownership in the query (`WHERE id = $1 AND wallet_id IN (...)`), and return `404` (not `403`) for other tenants' objects.
- A required **cross-tenant test suite** (IDOR tests) calls every `{id}` route as a different account and expects `404`.
- Seller-visible buyer data is limited to `agent_ref` = first 10 hex chars of `HMAC-SHA256(KEY_PEPPER, agent_key_id)`. No emails, wallet IDs, or key names.

### 8.5 Money safety

- All money-moving endpoints and jobs are **idempotent** and transactional (sections 4.8, 6.3, 7).
- Webhooks (`POST /webhooks/paypal`):
  - Read the **raw request body bytes** (Fastify raw-body plugin on this route only); re-serialized JSON changes the bytes and verification always fails.
  - Verify by calling `POST /v1/notifications/verify-webhook-signature` with `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` (from the `PAYPAL-*` headers), the **webhook ID** (from the Developer Dashboard, **different per environment**; never reuse the client ID) and the event; accept only `verification_status == "SUCCESS"`.
  - Persist to `webhook_events` (unique `paypal_event_id`), **return `200` immediately**, and process asynchronously through a `pg-boss` job so slow handling never makes PayPal retry or suspend delivery.
  - Never trust the body for amounts: re-fetch the order, capture, or payout item from PayPal before posting to the ledger.
- No client-supplied amount is trusted for settlement: capture amounts come from PayPal, payment amounts from the stored authorization.
- Invariant job (nightly, `P0`): (a) every transaction balanced, (b) materialized balances equal entry sums, (c) the accounting identity `G_PAYPAL + G_PAYPAL_FEES == W_AVAIL + W_HELD + S_PENDING + S_PAYOUT + G_FEES` holds. Failure raises an alert (log level `fatal` + visible status flag in `/ready` detail for admins).

### 8.6 Input validation and abuse

- Every route validates input with TypeBox; unknown properties rejected on writes.
- Rate limits (per key or per IP): `POST /v1/payments` 600/min per agent key; `redeem` 3000/min per seller key; portal auth routes 20/min per IP; other portal routes 300/min per session. `429` with `Retry-After`.
- Challenge URLs are stored as text and displayed with escaping; never rendered as HTML.
- SSRF: the facilitator never fetches URLs supplied by clients. (The only outbound calls are to PayPal.)

### 8.7 Logging, privacy, supply chain

- `pino` redaction for `authorization`, `cookie`, `token`, `key`, `secret`, PayPal credentials. Request IDs on every log line.
- Haggles never stores response bodies of seller content.
- CI runs `bun audit` (fail on high/critical), secret scanning (gitleaks), and CodeQL (`P1`). Lockfile committed; Dependabot or Renovate enabled.
- Docker images run as a non-root user, minimal base image, no dev dependencies.
- `SECURITY.md` explains how to report vulnerabilities.

### 8.8 Threat model summary (must be documented in docs "Security" page)

| Threat | Mitigation |
|---|---|
| Rogue site fakes a `402` naming another seller | Only the named seller (authenticated by seller key) can redeem; client checks URL match; policy `allowed_sellers`/`allowed_hosts`; per-call caps. |
| Token stolen and replayed | Bound to `url`+`method`+`amount`+`aud`; 60 s expiry; atomic `authorized→captured` makes redemption single-use. |
| Agent key leaked | Revocable instantly; policy caps bound loss; keys hashed at rest; never in browser. |
| Seller serves nothing after charge | Auto-refund on `5xx`; seller-initiated refund; receipts as evidence. |
| Double charge from retries | Idempotency keys on authorize and redeem; unique constraints. |
| Concurrent overspend | Single-statement guarded balance and spend-counter updates. |
| Facilitator outage | Seller fails closed (`503`); agents get a clear `FacilitatorUnavailableError`. |
| PayPal webhook spoofing | Signature verification + re-fetch from PayPal API. |
| Tenant data leak | Account-scoped queries, `404` for foreign IDs, IDOR test suite. |

---

## 9. Performance and reliability

### 9.1 Targets (measured with k6 on a Render Starter-class instance, 1 API instance)

| Operation | p50 | p99 | Throughput target |
|---|---|---|---|
| `POST /v1/payments` (server-side time) | < 15 ms | < 60 ms | 300 req/s |
| `POST /v1/payments/{id}/redeem` | < 12 ms | < 50 ms | 500 req/s |
| Seller middleware overhead on a paid request (local verify + redeem round trip within same region) | | < 120 ms added | |
| Portal page TTFB (authenticated, cached summary) | < 300 ms | | |

Targets are goals to be validated in M8; if missed, report numbers honestly in the docs.

### 9.2 How the design stays fast

- Hot path is **one Postgres transaction** with a handful of indexed single-row statements; no network calls to PayPal on the hot path.
- Signing is Ed25519 (fast). JWKS cached in sellers.
- Key lookup by unique `prefix` index; HMAC compare only.
- Connection pool via postgres.js (`max` configured per instance; Render Postgres connection limits respected).
- No ORM-generated N+1 queries; list endpoints use cursor pagination with covering indexes.
- Summary endpoints for dashboards use a single aggregate query each, with 5-second server-side memoization.

### 9.3 Reliability

- Stateless API instances; horizontal scaling safe because all state is in Postgres.
- Graceful shutdown on `SIGTERM` (stop accepting, finish in-flight, close pool within 10 s).
- `GET /health` (liveness) and `GET /ready` (DB + migration check) for Render health checks.
- Worker jobs are idempotent and retried with backoff (`pg-boss`), poison jobs go to a dead-letter queue and raise an alert log.
- Backups: Render Postgres daily backups on paid plans; document restore steps in `docs/operations`.

---

## 10. SDK specifications

All packages: TypeScript `strict`, dual ESM + CJS via `tsup`, bundled `.d.ts`, `"engines": {"node": ">=20"}`, `sideEffects: false`, semver, published to npm under `@haggles/*` (publishing is `P1`; workspace links are enough for `P0`). Every export has TSDoc with an example.

### 10.1 `@haggles/core` (P0)

Zero dependencies except `zod`. Exports:

```ts
// Money
export function parseMoney(s: string): bigint;          // "0.02" -> 20000n (micros); throws InvalidMoneyError
export function formatMoney(micros: bigint): string;    // 20000n -> "0.02" (min 2, max 6 decimals, trailing zeros trimmed past 2)

// Protocol
export const PROTOCOL_VERSION = 1;
export const HEADERS = { required: "haggles-payment-required", payment: "haggles-payment", receipt: "haggles-receipt" } as const;
export const ChallengeSchema: z.ZodType<Challenge>;
export interface Challenge { protocol: "haggles"; version: 1; scheme: "prepaid-usd"; challenge_id: string; amount: string; currency: "USD"; method: string; url: string; seller_id: string; description?: string; facilitator: string; expires_at: string }
export function encodeChallenge(c: Challenge): string;           // base64url(JSON)
export function decodeChallenge(h: string): Challenge;           // validates with ChallengeSchema
export function canonicalizeUrl(input: string): string;          // section 4.3
export interface PaymentTokenClaims { /* section 4.4 */ }
export interface ReceiptClaims { /* section 4.5 */ }

// Errors (all extend HagglesError with `code`, `status?`, `requestId?`)
export class HagglesError extends Error {}
export class InvalidMoneyError extends HagglesError {}
export class ChallengeMismatchError extends HagglesError {}
export class PolicyViolationError extends HagglesError {}
export class InsufficientFundsError extends HagglesError {}
export class PaymentNotAcceptedError extends HagglesError {}
export class NonReplayableBodyError extends HagglesError {}
export class FacilitatorUnavailableError extends HagglesError {}
```

`test-vectors/` contains JSON fixtures for: money parse/format, canonical URL cases (≥ 30), valid/invalid challenges, a sample signed token and receipt with the test public key. Every SDK and the API MUST pass these.

### 10.2 `@haggles/client` (P0)

```ts
import { createHaggles } from "@haggles/client";

const haggles = createHaggles({
  agentKey: process.env.HAGGLES_KEY!,          // required, "hgk_..."
  facilitatorUrl: "https://api.haggles.example.com", // default from env HAGGLES_FACILITATOR_URL
  maxPricePerCall: "0.10",                      // optional client-side guard (server policy is authoritative)
  bufferBody: false,                            // see 4.9 rule 5
  timeoutMs: 10_000,
  fetch: globalThis.fetch,                      // injectable for tests
  onPayment: (e) => {},                         // { paymentId, amount, url, sellerId }
  onError: (e) => {},
});

const res = await haggles.fetch("https://poems.example.com/poems/42");  // drop-in for fetch
const receipt = readReceipt(res);   // { paymentId, amount, capturedAt, raw } | null
const bal = await haggles.balance(); // { available, held, allowance: { perCallMax, dailyRemaining, monthlyRemaining } }
const paidFetch = haggles.wrap(fetch); // returns a fetch-compatible function
```

Behaviour is exactly section 4.9. Additional requirements:
- `haggles.fetch` accepts everything `fetch` accepts (`Request` objects included; clone before reading the body).
- Never retry the facilitator call on `4xx`. Retry network errors/`5xx` up to 2 times with the **same** `Idempotency-Key`.
- Throws typed errors from `@haggles/core`; error messages are actionable ("Daily limit of 5.00 reached; raise the limit in Buy → Keys").
- Emits no logs by default.

### 10.3 `@haggles/server` (P0)

Framework-agnostic core on Web-standard `Request`/`Response`, plus adapters.

```ts
// Core
import { createPaywallCore } from "@haggles/server";
// Adapters (P0: express, hono; P1: fastify, next)
import { paywall } from "@haggles/server/express";

const pay = paywall({
  sellerKey: process.env.HAGGLES_SELLER_KEY!,      // required "hgs_..."
  sellerId: process.env.HAGGLES_SELLER_ID!,        // required "slr_..."
  publicBaseUrl: "https://poems.example.com",      // required (4.3)
  facilitatorUrl: "https://api.haggles.example.com",
  refundOnError: true,
});

app.get("/poems/:id", pay({ price: "0.02", description: "One poem" }), handler);
```

- `price` is a decimal string; validated at startup (`parseMoney`, within limits) so misconfiguration fails fast, not at request time.
- The adapter passes the framework route pattern (`/poems/:id`) as `route` to redeem.
- Behaviour is exactly section 4.10. Exposes `onPayment`/`onError` hooks for the seller's own logging.
- Provides `pay.test()` helper for seller integration tests (mock facilitator) — `P1`.

### 10.4 `@haggles/mcp` (P1)

An MCP server (stdio) exposing tools `haggles_fetch(url, method?, headers?, body?)` and `haggles_balance()`, configured with `HAGGLES_KEY`. Lets any MCP client (e.g. Claude Desktop) buy from Haggles-protected URLs under the key's policy. If time is short, the demo agent uses a plain AI SDK tool wrapping `haggles.fetch` instead.

---

## 11. Portal UI specification

One Next.js app. **Desktop-first**, fully usable down to 375 px width. Built with **shadcn/ui** components, Tailwind, shadcn **chart** components (Recharts). Style: clean, minimal, neutral palette with one accent colour, generous whitespace, dark mode.

### 11.1 Design system

- **Theme:** shadcn "neutral" base, CSS variables for light/dark, user-selectable theme (system default), persisted in a cookie.
- **Accent:** the portal template's `--primary` token, unchanged (see `apps/portal/app/globals.css`). Chart colours use shadcn `--chart-1..5`.
- **Typography:** Space Grotesk (UI) and Geist Mono (keys, IDs, code) — from the portal template (D14).
- **Radius:** shadcn default (`0.5rem`). Shadows minimal; borders carry structure.
- **Components used** (install via shadcn CLI): `sidebar`, `card`, `button`, `input`, `label`, `select`, `switch`, `badge`, `table`, `tabs`, `dialog`, `alert-dialog`, `sheet`, `dropdown-menu`, `tooltip`, `skeleton`, `alert`, `separator`, `popover`, `calendar`, `chart`, `form`, `sonner`, `scroll-area`, `breadcrumb`, `avatar`, `progress`.
- **Custom components** (build once, reuse): `<Money value>`, `<CopyButton>`, `<KeyReveal>` (show-once secret), `<StatusBadge status>`, `<StatCard>`, `<DataTable>` (AG Grid Community + cursor pagination), `<EmptyState>`, `<CodeTabs>` (language tabs with copy), `<SandboxBanner>`, `<PolicySummary>`.

**Formatting rules**
- Money: `<Money>` uses `formatMoney` with a `$` prefix. `$12.50`, `$0.02`, `$0.0035`. Never scientific notation. Right-aligned in tables, tabular numerals.
- Dates: relative for < 24 h ("3 min ago", tooltip with full UTC timestamp), otherwise `Oct 6, 2026, 14:03`.
- IDs and keys: monospace, truncated in the middle (`pay_01J9…X4K`), `CopyButton` always beside them.
- Status badges: `authorized` secondary/blue, `captured` green, `refunded` amber outline, `released` muted, `created`/`pending` secondary, `processing` blue, `succeeded` green, `failed` destructive, `simulated` dashed outline.

**States (every data view MUST implement all four):** loading (skeletons matching final layout), empty (`EmptyState` with an explanation and one primary action), error (inline `Alert` with retry), populated.

**Accessibility:** WCAG 2.1 AA colour contrast, visible focus rings, full keyboard operation, dialogs trap focus, charts have a visually hidden data table or `aria-label` summary, `prefers-reduced-motion` respected.

**Live feel:** overview pages poll their summary and recent-activity queries every **5 seconds** with TanStack Query (`refetchInterval`), pausing when the tab is hidden. New rows fade in. No websockets in v1.

**Sandbox banner:** when `PAYPAL_MODE=sandbox`, a slim amber bar at the top of every page reads "Sandbox mode — no real money moves." (`<SandboxBanner>`).

### 11.2 App shell

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚠ Sandbox mode — no real money moves.                                      │
├───────────────┬────────────────────────────────────────────────────────────┤
│ ◆ Haggles     │  Breadcrumb                      [$ 12.40 available] ☾  (A) │
│               ├────────────────────────────────────────────────────────────┤
│ BUY           │                                                            │
│  Overview     │                     page content                           │
│  Wallet       │                                                            │
│  Agent keys   │                                                            │
│  Payments     │                                                            │
│ SELL          │                                                            │
│  Overview     │                                                            │
│  Setup        │                                                            │
│  Endpoints    │                                                            │
│  Calls        │                                                            │
│  Earnings     │                                                            │
│  Seller keys  │                                                            │
│ ─────         │                                                            │
│  Docs ↗       │                                                            │
│  Account      │                                                            │
└───────────────┴────────────────────────────────────────────────────────────┘
```

- Sidebar (shadcn `sidebar`): collapsible to icons at < 1024 px; becomes a `Sheet` below 768 px. Sections "BUY" and "SELL" only appear if the account has that role enabled; a disabled section shows a single "Enable selling / buying" item.
- Header: breadcrumb (left); **wallet pill** (available balance, links to Wallet; hidden if not a buyer), theme toggle, avatar dropdown (Account, Docs, Sign out).

### 11.3 Public and onboarding pages

**`/` Landing (minimal, P0)**
- Hero: headline "Get paid when AI agents use your API." Subtext: one sentence. Primary button "Sign in with PayPal"; secondary "Read the docs".
- "How it works" in 3 cards (Seller adds middleware → Agent gets a 402 and pays → You get paid via PayPal).
- A 10-line code tabs block (Seller / Buyer) using `<CodeTabs>`.
- Footer: GitHub, Docs, License.

**`/login`**: centered card, PayPal login button, sandbox note, link to privacy/terms stub pages (`P1`).

**`/onboarding`** (first login only): two selectable cards "I want to sell" / "I want to buy" (multi-select, at least one), "Continue". Result sets `is_buyer`/`is_seller` and creates the wallet and/or seller record. Changeable later in Account.

### 11.4 Buy section

**`/buy` — Overview (P0)**
```
┌ Available ──┐┌ Held ───────┐┌ Spent today ┐┌ Spent 30 days ┐
│ $12.40      ││ $0.08       ││ $0.31       ││ $4.17         │
│ [Add funds] ││ 3 in flight ││ of $5.00 ▓░ ││               │
└─────────────┘└─────────────┘└─────────────┘└───────────────┘
┌ Spend, last 30 days (area chart, daily)                      ┐
│                                                              │
└──────────────────────────────────────────────────────────────┘
┌ Recent payments (10)                           [View all →] ┐
│ Time      Seller        URL                 Key     Amount  Status │
└──────────────────────────────────────────────────────────────┘
```
- If `available < 1.00`: top `Alert` (warning) "Low balance. Agents will start failing when it runs out." with "Add funds".
- "Spent today of $X" uses a `Progress` bar against the **smallest** `daily_max` across active keys; hidden if no keys.
- Empty state (no keys, no funds): 3-step checklist card: ① Add funds ② Create an agent key ③ Install `@haggles/client` (with snippet).

**`/buy/wallet` — Wallet (P0)**
- Balance card: Available, Held, "Max balance $500.00".
- **Add funds** button → `Dialog`: preset chips ($5, $10, $25, $50), custom amount input (validates min/max/wallet cap inline), then PayPal buttons render beneath (PayPal JS SDK). On success: dialog closes, toast "Added $25.00", balance refreshes.
- "Top-up history" `DataTable`: Date, Amount, Status, PayPal order (mono, copy). 
- Note text: "Funds are prepaid credit used by your agents. Unused balance refunds are handled manually on request during the preview" (copy to be finalized with R3).

**`/buy/keys` — Agent keys (P0)**
- `DataTable`: Name, Key (`hgk_test_ab12…`), Policy summary (`<PolicySummary>`: "≤ $0.10/call · $5/day"), Spent today, Last used, Status, row actions (⋯: Edit policy, Revoke).
- **Create key** → `Sheet` (right side):
  - Name (required, 1–60 chars)
  - Per-call max (default 0.10), Daily max (default 5.00), Monthly max (optional)
  - Allowed sellers (optional, tag input of `slr_` IDs), Allowed hosts (optional, tag input)
  - Expiry (optional date picker)
  - Submit → `KeyReveal` `Dialog`: shows the full key once, big `CopyButton`, an `.env` snippet (`HAGGLES_KEY=hgk_test_...`), checkbox "I've stored this key" required to close.
- Revoke → `AlertDialog` ("Agents using this key will stop working immediately."), type the key name to confirm.

**`/buy/keys/[id]` — Key detail (P1)**: policy form (same fields, inline), 7-day usage chart, that key's payments table.

**`/buy/payments` — Payments (P0)**
- Filters row: date range (`Popover`+`Calendar`), key (`Select`), status (`Select`), seller (text).
- `DataTable` (cursor pagination, 25/page): Time, Seller, URL (truncated, tooltip), Key, Amount, Status.
- Row click → `Sheet`: payment ID, status timeline (authorized → captured → refunded/released with timestamps), full URL, seller ID, amount, key name, receipt (copy), challenge ID.

### 11.5 Sell section

**`/sell` — Overview (P0)**
```
┌ Pending ────┐┌ Paid out ───┐┌ Calls (24h) ┐┌ Revenue (30d) ┐
│ $3.20       ││ $41.00      ││ 1,284       ││ $26.90        │
│ [Request payout]                                             │
└─────────────┘└─────────────┘└─────────────┘└───────────────┘
┌ Revenue, last 30 days (area chart)                           ┐
└──────────────────────────────────────────────────────────────┘
┌ Top endpoints (5)                         ┐┌ Recent calls ────┐
│ GET /poems/:id   $12.00   600 calls       ││ time · agent · $ │
└───────────────────────────────────────────┘└──────────────────┘
```
- If setup is incomplete, a top card "Finish setup" links to `/sell/setup` with progress (e.g. 2 of 4).

**`/sell/setup` — Setup (P0)** — a vertical checklist, each step expandable:
1. **Payout account**: shows the PayPal account the seller signed in with (email, masked payer ID) with a green check. No separate connection step exists, because login already provides the `payer_id` used for payouts (7.2). In live mode it also shows PayPal's `verified_account` status, and payouts stay disabled until it is true (`P1`).
2. **Create seller key**: button → `KeyReveal` dialog (same pattern) and shows `slr_` seller ID.
3. **Install middleware**: `<CodeTabs>` (Express / Hono) with the seller's real `sellerId` pre-filled and `publicBaseUrl` placeholder highlighted. Includes `bun add @haggles/server`.
4. **Make a first paid call** (P0 as a passive indicator, P1 for the test key): shows a copyable Node snippet and a live indicator "Waiting for your first paid call…" that turns green when the seller's first `captured` payment arrives (polling every 5 s). A seller who is also a buyer can use their own agent key. In sandbox, a **test key** (P1, `POST /seller/test-key`) issues a platform-owned agent key restricted to this seller (`allowed_sellers`), capped at `0.50`/day, funded from a system wallet. The facilitator never fetches the seller's URL itself (see 8.6, SSRF).

**`/sell/endpoints` — Endpoints (P0)**
- `DataTable`: Name (display name, falls back to `route`), Method, Route, Price (last seen), Calls 30d, Revenue 30d, Status (`Switch`: active/hidden, display only; does not block payments in v1).
- Row click → `Sheet` with editable name and description, 30-day mini chart, last 10 calls.
- Empty state: "Endpoints appear here after their first paid call." with link to Setup.
- Pause-all control: a `Switch` "Accept payments" (sets `sellers.status`; when off, `POST /v1/payments` for this seller returns `seller_paused` and middleware returns `503`). (P1)

**`/sell/calls` — Calls (P0)**: `DataTable` with Time, Endpoint, Agent (`agent_ref`, mono), Gross, Fee, Net, Status; filters date range, endpoint, status. Row `Sheet` shows full URL, payment ID, receipt, and a **Refund** button (`AlertDialog`) for `captured` payments < 24 h old (P1).

**`/sell/earnings` — Earnings (P0)**
- Three cards: Pending, Processing (in-flight), Paid out (lifetime).
- Payout destination card: PayPal email, mode badge (`PayPal` or `Simulated`).
- "Request payout" button: disabled with tooltip when pending < $1.00 or a request was made in the last hour.
- "Payouts" `DataTable`: Date, Amount, Status, PayPal batch ID (mono, copy), Failure reason.
- Info line: "Automatic payouts run every Monday 00:00 UTC for balances ≥ $1.00."

**`/sell/keys` — Seller keys (P0)**: same pattern as agent keys (name, prefix, last used, status, create, revoke). Max two active keys; creating a third shows a disabled button with tooltip "Revoke a key to rotate".

### 11.6 Account

**`/account` (P0)**: profile (name, PayPal email read-only), role switches (`Switch` for Buyer, Seller; cannot disable a role with non-zero balance), "Sign out all sessions", environment info (API URL, mode), and a danger zone "Delete account" (disabled while any balance or pending payout exists; `P1`).

### 11.7 Copy and tone

Plain, specific, calm. No jargon in UI text ("Add funds", not "Fund wallet ledger"). Errors say what happened and what to do next. Never expose internal error codes without a human sentence.

---

## 12. Demo applications (`examples/`)

All use the real SDKs and the deployed sandbox facilitator, and each has a README that runs in under 2 minutes.

### 12.1 `seller-datasets` (Hono, `P0`)
Endpoints (prices): `GET /datasets/rent-index?city=` ($0.03), `GET /datasets/transit-fares?city=` ($0.01), `GET /datasets/summary` (free, shows that unpaid routes still work). Data is a small, genuinely useful, **honestly labelled sample dataset** checked into the repo (no scraped or copyrighted data).

### 12.2 `seller-poems` (Express, `P0`)
`GET /poems/random` ($0.005), `GET /poems/:id` ($0.02). Poems are original or public-domain, committed in the repo.

### 12.3 `buyer-research-agent` (Next.js + AI SDK, `P0`)
A research assistant. The user types a question ("Compare rent and transit costs between City A and City B"). An LLM agent (Gemini via Vertex AI, through the Vercel AI SDK provider `@ai-sdk/google-vertex`; model configurable by env) has tools:
- `list_sources` → returns a static catalogue of the two demo sellers' URLs and descriptions (a stand-in for discovery).
- `buy_source(url)` → `haggles.fetch(url)`; returns the content and price paid.
UI (single page, minimal, same shadcn styling): chat on the left; on the right a live **"Spend" panel** listing each purchase as it happens (seller, URL, amount, running total, remaining daily allowance) and a final line such as "Bought 3 sources for $0.07." A visible "policy hit" state shows the failure message when the key's cap blocks a purchase, so the guardrail is demonstrable on camera. Configuration: `HAGGLES_KEY`, LLM API key.

### 12.4 Demo script (3 minutes, `P0`)
0:00 problem in 15 s → 0:15 seller setup (2 lines of middleware, portal showing endpoint) → 0:45 buyer funds wallet via PayPal sandbox, creates a key with a $0.10 daily cap → 1:15 agent answers a question, buying sources live, portal ticking → 2:00 agent hits the cap and is stopped → 2:15 seller dashboard shows earnings, request payout → 2:45 summary (repo, docs, license). Show the running app on screen; no third-party logos or copyrighted music.

---

## 13. Documentation requirements

Documentation is a deliverable, judged alongside the code. "Done" for any feature includes its docs.

### 13.1 Documentation site (`apps/docs`, Astro Starlight, deployed as a static site)

```
Getting started
  ├─ What is Haggles?              (concepts in 1 page, diagram of the flow)
  ├─ Quickstart: sell (5 minutes)  (sign in → seller key → 2 lines of middleware → first payment)
  └─ Quickstart: buy (5 minutes)   (fund → agent key → haggles.fetch)
Concepts
  ├─ Prepaid wallets and the ledger (state the assumption A1 honestly)
  ├─ Spending policies
  ├─ Payments lifecycle (state machine, refunds)
  └─ Security model (threat table from 8.8)
Protocol reference
  ├─ Headers, challenge, token, receipt (section 4, with test vectors)
  └─ Error catalogue (Appendix A)
API reference                      (generated from openapi.json)
SDK reference                      (generated by TypeDoc from TSDoc)
Guides
  ├─ Paywall an Express API / a Hono API / a Next.js route
  ├─ Give an AI SDK agent a paid-fetch tool
  ├─ Use Haggles from MCP (P1)
  └─ Going to production (checklist, including regulatory note R3)
Operations
  ├─ Self-hosting the facilitator (Docker, env vars, Render blueprint)
  └─ Backups, rotating keys, incident basics
FAQ · Changelog · Contributing
```

### 13.2 Rules

- **Generated where possible:** OpenAPI from route schemas; SDK reference from TSDoc. CI fails if `openapi.json` is stale or an exported symbol lacks TSDoc.
- **Examples must compile:** every code block in Quickstarts and Guides is sourced from files under `examples/` or `apps/docs/snippets/` that are typechecked in CI.
- **`llms.txt` and `llms-full.txt`** are published at the docs root so AI agents can read the docs (fitting for this project).
- **README.md** contains: one-paragraph pitch, a diagram, the 5-minute seller and buyer quickstarts, how to run everything locally with `docker compose up` and `bun run dev`, links to hosted demo and docs, license badge, and hackathon tool credits (section 16.3).
- **Honesty section:** the docs list the assumptions (2.2) and known limitations (non-goals 1.4, risks 17) in plain language.
- **Changelog** follows Keep a Changelog; versions follow semver; protocol version bumps are called out.

---

## 14. Infrastructure and deployment

### 14.1 Docker

- One **multi-stage Dockerfile per deployable** (`apps/api` also builds the worker; the worker uses the same image with `CMD ["node","dist/worker.js"]`).
- Base `oven/bun:1` (slim variant); build stage uses `bun install --frozen-lockfile` with a cache mount; runtime stage contains only production dependencies (Bun workspace install scoped to the deployable; the implementing agent verifies the exact incantation and keeps it in the Dockerfile), runs as a non-root user, uses `tini` as PID 1, sets `NODE_ENV=production`, defines a `HEALTHCHECK` that calls `/health`, and exposes port 3000.
- `.dockerignore` excludes `.git`, `node_modules`, tests, docs, `.env*`.
- Images MUST NOT contain secrets; all configuration is by environment variables (twelve-factor).

Reference sketch (the implementing agent adapts and tests it):

```dockerfile
# syntax=docker/dockerfile:1
FROM oven/bun:1-slim AS base
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=bun,target=/root/.bun/install/cache bun install --frozen-lockfile
RUN bun --filter @haggles/api run build
RUN bun install --production --filter @haggles/api

FROM oven/bun:1-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
USER bun
WORKDIR /app
COPY --from=build --chown=bun:bun /repo ./
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD bun -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["bun","apps/api/dist/server.js"]
```

### 14.2 Local development

- `docker compose up -d` starts Postgres 16 and Redis 7.
- `bun install && bun run db:migrate && bun run dev` runs API, worker, portal, and docs with hot reload.
- `PAYPAL_MODE=mock` (default locally and in CI) swaps in an in-memory `PayPalGateway` that simulates orders, captures, webhooks, and payouts, including failure modes. `PAYPAL_MODE=sandbox` uses real sandbox credentials. `PAYPAL_MODE=live` is forbidden until R3 is resolved.
- A `bun run seed` script creates two demo sellers, one buyer with a funded wallet, and sample payments for UI development.

### 14.3 Render

Blueprint file `render.yaml` at repo root. Field names below follow Render's current Blueprint reference (`runtime` not `env`, `keyvalue` not `redis`, `autoDeployTrigger` not `autoDeploy`; `fromService` properties are `host`, `port`, `hostport`, `connectionString`, `envVarKey`). CI validates the file against Render's published JSON Schema (`https://render.com/schema/render.yaml.json`) so a typo fails the build instead of the deploy. Shared secrets are declared under a top-level `envVarGroups:` entry named `haggles-shared` (values entered in the dashboard, `sync: false` for secrets).

```yaml
databases:
  - name: haggles-db
    plan: basic-256mb        # choose a paid plan for the judging window
    postgresMajorVersion: "16"

services:
  - type: keyvalue
    name: haggles-kv
    plan: starter
    ipAllowList: []          # private network only

  - type: web
    name: haggles-api
    runtime: docker
    dockerfilePath: ./apps/api/Dockerfile
    dockerContext: .
    plan: starter
    healthCheckPath: /ready
    preDeployCommand: node dist/migrate.js
    autoDeployTrigger: checksPass
    envVars:
      - fromGroup: haggles-shared
      - key: DATABASE_URL
        fromDatabase: { name: haggles-db, property: connectionString }
      - key: REDIS_URL
        fromService: { type: keyvalue, name: haggles-kv, property: connectionString }

  - type: worker
    name: haggles-worker
    runtime: docker
    dockerfilePath: ./apps/api/Dockerfile
    dockerContext: .
    dockerCommand: node dist/worker.js
    plan: starter
    envVars:
      - fromGroup: haggles-shared
      - key: DATABASE_URL
        fromDatabase: { name: haggles-db, property: connectionString }

  - type: web
    name: haggles-portal
    runtime: docker
    dockerfilePath: ./apps/portal/Dockerfile
    dockerContext: .
    plan: starter
    healthCheckPath: /api/health
    envVars:
      - fromGroup: haggles-shared
      - key: API_INTERNAL_URL
        fromService: { type: web, name: haggles-api, property: hostport }

  - type: web
    name: haggles-docs
    runtime: static
    buildCommand: bun install --frozen-lockfile && bun --filter @haggles/docs run build
    staticPublishPath: apps/docs/dist
```

Also add the demo services (`seller-datasets`, `seller-poems`, `buyer-research-agent`) in the same style, each with its own env vars (`HAGGLES_SELLER_KEY`, etc.).

Operational notes:
- **Do not use free-tier instances for the API, portal, or demo services during judging.** Render spins a free web service down after 15 minutes without inbound traffic and it takes about a minute to wake, which would ruin a live demo. Free web services also have monthly instance-hour limits.
- **Do not use the free Postgres.** Render's free Postgres databases **expire 30 days after creation** (14-day grace period to upgrade), which could delete the data mid-judging. Use a paid Postgres plan.
- **Background workers and private services have no free tier** (they start at Starter), so the worker costs money from day one.
- Static sites (docs) are free.
- `preDeployCommand` is a paid-instance feature; the API runs on a paid plan, so it is available.
- Use Render **environment groups** for secrets shared across services (`haggles-shared`); mark secrets as non-synced where applicable.
- Portal → API traffic uses Render's **private network** via `API_INTERNAL_URL`. The API's **public** URL is what SDKs and PayPal webhooks use.
- Migrations run as `preDeployCommand`. They are **forward-only** and follow expand/contract so the previous release keeps working while the new one deploys. Never edit an applied migration.
- Zero-downtime deploys are via Render's rolling deploys plus the health check; the API handles `SIGTERM` gracefully (9.3).

### 14.4 CI/CD (GitHub Actions)

On every PR: install (cached) → lint → typecheck → unit tests → integration tests (Postgres service container) → build all packages → OpenAPI drift check → docs build + example typecheck → `bun audit` → gitleaks. On `main`: all of the above, then Render auto-deploys once checks pass. Docker image build is verified in CI (build only; no registry push needed).

### 14.5 Configuration reference

| Variable | Used by | Description |
|---|---|---|
| `NODE_ENV` | all | `production` in deployments |
| `HAGGLES_ENV` | api | `test` or `live`; controls key prefix acceptance |
| `PORT` | api, portal | Default 3000 |
| `DATABASE_URL` | api, worker | Postgres connection string |
| `REDIS_URL` | api | Rate limiting store; absent → in-memory limiter (dev only) |
| `PUBLIC_API_URL` | api, portal | Public base URL of the API (`iss` claim, challenge `facilitator`) |
| `PUBLIC_PORTAL_URL` | api | Portal origin (Origin check, OIDC redirect) |
| `API_INTERNAL_URL` | portal | Private-network base URL for rewrites |
| `MASTER_KEY` | api, worker | base64 32 bytes; encrypts signing keys |
| `KEY_PEPPER` | api, worker | base64 32 bytes; HMAC for API keys and `agent_ref` |
| `PAYPAL_MODE` | api, worker | `mock`, `sandbox`, `live` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | api, worker | Sandbox/live REST app credentials |
| `PAYPAL_WEBHOOK_ID` | api | Webhook ID from the Developer Dashboard, **per environment** (sandbox and live differ) |
| `PAYPAL_OIDC_REDIRECT_URI` | api | Exact Return URL registered for Log in with PayPal |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | portal | PayPal JS SDK client ID |
| `PLATFORM_FEE_BPS` | api, worker | Default 500 |
| `PRICE_MIN_MICROS`, `PRICE_MAX_MICROS` | api | Defaults 100 and 5,000,000 |
| `TOPUP_MIN_MICROS`, `TOPUP_MAX_MICROS`, `WALLET_MAX_MICROS` | api | Defaults 5e6, 200e6, 500e6 |
| `PAYOUT_MIN_MICROS` | worker | Default 1,000,000 |
| `LOG_LEVEL` | all | Default `info` |

Validated at startup with Zod; the process exits with a clear message on missing or malformed values.

---

## 15. Testing strategy

| Layer | Tooling | Must cover |
|---|---|---|
| Unit | Vitest | `parseMoney`/`formatMoney`, `canonicalizeUrl`, token sign/verify, policy math, fee rounding |
| Contract | Vitest + shared `test-vectors` | Every SDK and the API produce/accept the same bytes |
| Property-based | fast-check | Random sequences of authorize/redeem/refund/release/top-up/payout never break ledger invariants (8.5) or push guarded accounts negative |
| Integration | Vitest + Testcontainers (real Postgres) + mock PayPal | Full flows through HTTP; migrations apply cleanly from empty |
| Concurrency | Vitest | 100 parallel `POST /v1/payments` against a balance that affords 10 → exactly 10 succeed; 50 parallel redeems of one token → exactly one `200`; concurrent policy-cap races |
| Idempotency | Vitest | Retrying authorize/redeem/refund/webhook/payout submission any number of times yields one effect |
| Security | Vitest | Cross-tenant (IDOR) suite over all `{id}` routes; revoked/expired keys; CSRF enforcement; webhook with bad signature; token with wrong `aud`/`url`/`amount`/`exp` |
| SDK | Vitest + local fake facilitator | Client: 402 handling, URL mismatch, non-replayable bodies, retries. Server: all rejection paths, fail-closed, auto-refund |
| E2E | Playwright (mock PayPal) | Sign in → fund → create key → run demo agent → see payment → seller sees earnings → payout |
| Load | k6 | Targets in 9.1; results committed to `docs/performance.md` |
| Sandbox smoke | Manual checklist, scripted where possible | Real PayPal sandbox top-up, webhook, payout (M3 and before submission) |

Coverage gate: ≥ 85% lines on `apps/api/src/{ledger,services}` and `packages/*`; no gate on UI, but critical flows covered by E2E.

---

## 16. Milestones, work split, definition of done

**Submission deadline: 2026-11-15** (kickoff 2026-10-07, 39 days). Milestones are ordered by dependency; the order must be preserved. Target windows: M0 Oct 7–9 · M1 Oct 9–13 · M2 Oct 13–19 · M3 Oct 18–23 · M4 Oct 21–25 · M5+M6 Oct 20–30 · M7 Oct 30–Nov 4 · M8 Nov 4–11 · buffer Nov 11–15.

### 16.1 Milestones

| # | Milestone | Priority | Exit criteria |
|---|---|---|---|
| **M0** | **PayPal sandbox setup and smoke test** (≈1 day) | P0 | Sandbox business + two personal accounts created; REST app with *Log in with PayPal* enabled and Return URL set; webhook registered (ID recorded per environment); `scripts/paypal-smoke.ts` passes: login → userinfo returns `payer_id`; Orders create+capture returns fee and net; webhook signature verifies; $0.01 payout reaches `SUCCEEDED` (test U1, else `simulated` is chosen); PayPal button renders under the production CSP (test U2). Results recorded in `docs/operations/paypal-setup.md`. |
| **M1** | Repo, core package, protocol | P0 | Monorepo, CI, lint/format; `@haggles/core` complete with test vectors; Fastify skeleton with `/health`, `/ready`, OpenAPI generation; DB schema + migrations (6.1). |
| **M2** | Ledger and payment engine | P0 | Accounts, postings, authorize/redeem/refund/release, policies, spend counters, signing keys + JWKS; property, concurrency and idempotency tests green; no PayPal needed (mock). |
| **M3** | PayPal integration | P0 | `PayPalGateway` real + mock implementations; top-up flow (7.1) with webhook; payout job (7.2); OIDC login; sessions + CSRF; sandbox smoke test passes. |
| **M4** | SDKs | P0 | `client` and `server` (Express + Hono adapters) done against a local facilitator; SDK tests green; a 5-line seller and a 5-line buyer example work end to end. |
| **M5** | Portal: shell, auth, Buy section | P0 | App shell, login, onboarding, Buy overview/wallet/keys/payments with real data; all four UI states. (Can start after M1 against the OpenAPI mock server.) |
| **M6** | Portal: Sell section + account | P0 | Sell overview/setup/endpoints/calls/earnings/keys; account page. |
| **M7** | Demo apps + agent | P0 | Both seller demos, research agent with live Spend panel, policy-hit scenario reproducible on demand. |
| **M8** | Docs, deploy, hardening, submission | P0 | Docs site complete (13.1); Render blueprint deployed on paid plans; load test run; security checklist (8) verified; demo video recorded; submission checklist (16.3) complete. |
| **M9** | Stretch | P1 | `@haggles/mcp`, Fastify/Next adapters, seller test key, refund button, key rotation job, key detail page, pause-all switch. |

**Cut order if time runs short** (cut first → last): M9 items, key detail page, seller refund button, pause-all, Next/Fastify adapters, then simplify charts (tables only). **Never cut:** mandates/policies, ledger tests, idempotency, security items in section 8, docs quickstarts, the real PayPal sandbox top-up and payout.

### 16.2 Suggested work split (two humans + AI agents)

- **Developer A (backend):** M0, M1 (API/DB), M2, M3.
- **Developer B (frontend/DX):** M1 (monorepo, CI), M5, M6, M7, docs site.
- **Both:** M4 (A leads server logic, B leads client + examples), M8.
- **AI agents:** scaffolding, boilerplate routes from schemas, tests from the test matrix (15), docs pages from OpenAPI/TSDoc, shadcn page scaffolds, under the rules in 0.2. **Humans review every PR touching sections 4, 6, 7, or 8.**
- **Contract-first:** B builds against the committed `openapi.json` and a mock server (e.g. Prism or MSW) until A's endpoints land. Any API change updates `openapi.json` in the same PR.

### 16.3 Hackathon submission checklist (from the official requirements)

- [ ] Project meaningfully uses **PayPal** (Orders, OIDC, Payouts, webhooks) **and AI** (demo research agent with LLM tool calling; agent-key policies enforce limits on AI spend).
- [ ] **Text description** of features and functionality.
- [ ] **Functional demo**: hosted URL **and** clear run instructions in the README.
- [ ] **Tools list** explaining how each tool was used (include any sponsor tools actually used: e.g. Render for hosting; APIMatic if SDKs/docs are generated from `openapi.json`; Postman collection from `openapi.json`; AG Grid is used for all portal data tables (D13)).
- [ ] **Public GitHub repo**, all source and assets, **open-source license visible** in the repo's About section (MIT).
- [ ] **Demo video** < 3 minutes, shows the working project, uploaded **publicly to YouTube**, link on the submission form; no third-party trademarks or copyrighted music.
- [ ] Docs sufficient for judges to run and evaluate (section 13).
- [ ] Complies with the Official Rules (read them before submitting; confirm the deadline).

### 16.4 Definition of done (every task)

1. Behaviour matches this spec (cite sections).
2. Tests added per section 15; money paths include idempotency and ledger-balance tests.
3. Types strict; lint and formatting clean; no `any` without a justification comment.
4. TSDoc/OpenAPI updated; docs page updated or added; `openapi.json` regenerated.
5. No secrets or tokens in logs, code, or fixtures.
6. UI work: all four states, keyboard accessible, dark mode checked, works at 375 px.
7. PR description lists spec sections touched and any deviations (deviations require a spec change).

---

## 17. Risks and open questions

### 17.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Your sandbox business account cannot send payouts (docs say sandbox payouts are supported, so this is account-level) | Low / High | Test U1 in M0; fallback `simulated` payouts, clearly labelled |
| R2 | **Live** "Log in with PayPal" requires PayPal's app review and approval of all scopes (sandbox does not) | High (for live) / Medium | Hackathon runs on sandbox; start the live review early if a real launch is planned; keep a documented alternative (email-based login) as a `P2` fallback |
| R3 | **Prepaid balances may be regulated** (money transmission / stored value) in a real launch | High (for real launch) / High | Caps (2.3); sandbox-only for hackathon; docs section "Going to production" says what is needed (legal review, licensing, or a partner holding funds); do not market as production-ready |
| R4 | PayPal fees and payout delays make small sellers' economics poor | Medium / Medium | Payout minimum, weekly batching; fees read from API and shown in the UI; be honest in docs |
| R5 | Render free-tier behaviour (spin-down after 15 min idle, free Postgres expiring after 30 days) breaks the demo | High if free tiers are used / High | Paid always-on web plans, paid Postgres, paid worker; health checks; test the deployed demo daily in the last week |
| R6 | PayPal sandbox slowness or outages during recording or judging | Medium / High | Pre-fund wallets, seed data, record demo video from a rehearsed run, keep a recorded fallback |
| R7 | LLM nondeterminism makes the agent demo flaky | High / Medium | Low temperature, a scripted prompt, retry button, deterministic tool catalogue; policy-hit scenario triggered by a fixed low cap |
| R8 | Scope creep | High / High | Priority tags and cut order (16.1) are binding |
| R9 | Single-ledger bug causes money errors | Low / Very high | Property tests, invariant job, double-entry constraints, human review of sections 6–7 code |

### 17.2 Open questions (must be answered by a human before the relevant milestone)

| # | Question | Resolution (2026-10-07) |
|---|---|---|
| Q1 | Fastify (TypeScript) vs Python FastAPI | **Fastify** confirmed (D1) |
| Q2 | Submission deadline and milestone owners | **2026-11-15**; schedule in 16.1 |
| Q3 | Platform fee | **5%** default kept (`PLATFORM_FEE_BPS=500`) |
| Q4 | LLM provider/model for demo agent | **Gemini via Vertex AI** on the owner's GCP project (D15) |
| Q5 | AG Grid vs TanStack Table | **AG Grid Community** (D13) |
| Q6 | Domain / npm scope | Default `*.onrender.com` URLs (D16); npm `@haggles` scope availability checked at M4 |
| Q7 | Additional sponsor tools | AG Grid (portal tables) and Render (hosting) are deliberate; APIMatic/Postman only if time allows in M8 |

---

## Appendix A — Error code catalogue

| `code` | HTTP | Meaning | Who sees it |
|---|---|---|---|
| `invalid_challenge` | 422 | Challenge fails schema or limits | Client |
| `seller_not_found` | 404 | `seller_id` unknown | Client |
| `seller_paused` | 409 | Seller is not accepting payments | Client |
| `policy_violation` | 403 | Per-call, daily, monthly, seller, host, or expiry rule failed (`detail` names which) | Client |
| `insufficient_funds` | 409 | Available balance below amount | Client |
| `key_revoked` | 401 | Key revoked, expired, or unknown | Client/Seller |
| `unauthorized` | 401 | Missing or malformed credentials | Any |
| `forbidden` | 403 | Authenticated but not allowed | Any |
| `not_found` | 404 | Object does not exist or belongs to another tenant | Any |
| `already_redeemed` | 409 | Token or payment already captured (different idempotency key) | Seller |
| `amount_mismatch` | 409 | Token amount differs from seller's required amount | Seller |
| `request_mismatch` | 409 | Token `method`/`url` differ from the request | Seller |
| `token_expired` | 410 | Token or hold expired | Seller |
| `refund_not_allowed` | 409 | Not captured, already refunded, or window (24 h) passed | Seller |
| `idempotency_conflict` | 422 | Same key reused with a different request body | Any |
| `wallet_limit_exceeded` | 409 | Top-up would exceed max balance | Portal |
| `wallet_frozen` | 403 | Wallet frozen after reversal/risk event | Client/Portal |
| `rate_limited` | 429 | Too many requests (`Retry-After` set) | Any |
| `facilitator_unavailable` | 503 | Dependency down (client-side error type; seller middleware responds `503`) | Seller/Client |
| `internal_error` | 500 | Unexpected; message is generic, details only in logs with `request_id` | Any |

## Appendix B — Spec change process

1. Open a PR that edits `SPEC.md` (and nothing else) describing the change and why.
2. Both humans approve. Changes to sections 4, 6, 7, 8 need explicit sign-off from both.
3. Implementation PRs reference the merged spec change.
4. When an implementation reveals a gap, add the question to section 17.2 instead of guessing.

## Appendix C — Verified external facts and sources (checked 2026-10-06)

Everything in this table was read from official PayPal, Render, or pnpm documentation during spec preparation. If an implementation disagrees with a row, stop and report (section 0.2 rule 7).

Note: the pnpm `deploy` row below is retained for the historical record; pnpm is no longer used (D12).

| Topic | Fact used in this spec | Source |
|---|---|---|
| Payouts endpoint and sandbox | `POST https://api-m.sandbox.paypal.com/v1/payments/payouts` (live: `api-m.paypal.com`); sandbox payouts go to sandbox accounts; up to 15,000 items per call; sender balance must cover payouts plus fees | developer.paypal.com/docs/payouts/standard/integrate-api |
| Payouts idempotency | A `sender_batch_id` used in the last 30 days is rejected with the duplicate ID and a HATEOAS link to the original payout | developer.paypal.com/docs/api/payments.payouts-batch/v1/ |
| Payouts recipients and amounts | `recipient_type` ∈ `EMAIL`, `PHONE`, `USER_HANDLE`, `PAYPAL_ID`; amount `value` is a string like `"9.87"`; per-item fees reported in batch/item details (fee populated after the item is pending) | developer.paypal.com/api/payouts; paypal.ai/docs/send-payouts/send-money/use-payouts-apis |
| Payout webhooks | Batch: `PAYMENT.PAYOUTSBATCH.DENIED/PROCESSING/SUCCESS` (no item info). Item: `PAYMENT.PAYOUTS-ITEM.BLOCKED/CANCELED/DENIED/FAILED/HELD/REFUNDED/RETURNED/SUCCEEDED/UNCLAIMED`. `SUCCEEDED` should be confirmed via item details (`transaction_status == SUCCESS`) | developer.paypal.com/api/rest/webhooks/event-names/; docs.paypal.ai/send/webhook-reference |
| Orders capture | `POST /v2/checkout/orders/{id}/capture`; result at `purchase_units[0].payments.captures[0]` with `status` and `seller_receivable_breakdown.{paypal_fee, net_amount}`; `PayPal-Request-Id` header for idempotency | developer.paypal.com/api/orders/v2/orders-capture |
| Capture webhooks | `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REVERSED`, `CHECKOUT.PAYMENT-APPROVAL.REVERSED` | developer.paypal.com/api/rest/webhooks/event-names/; developer.paypal.com/bancomat |
| Webhook verification | `POST /v1/notifications/verify-webhook-signature` with `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time`, `webhook_id`, `webhook_event`; returns `verification_status` (`SUCCESS`); raw body required; webhook ID is per environment; access tokens last ~9 hours | developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post; developer.paypal.com/invoicing/troubleshooting |
| Log in with PayPal setup | Enable per app in the Developer Dashboard with an exact Return URL; sandbox needs no review, live apps are reviewed and all scopes need approval | developer.paypal.com/docs/log-in-with-paypal/integrate/ |
| Log in with PayPal endpoints and scopes | Authorize at `www.sandbox.paypal.com/signin/authorize` (live `www.paypal.com`); token at `/v1/oauth2/token`; userinfo at `/v1/identity/oauth2/userinfo?schema=paypalv1.1`; scope `https://uri.paypal.com/services/paypalattributes` provides `payer_id` (used by Payouts) and verification status | developer.paypal.com/docs/log-in-with-paypal/integrate/build-button/; …/integrate/reference/; developer.paypal.com/limited-release/verify-with-paypal/integrate |
| Userinfo fields | `user_id`/`sub`, `payer_id`, `verified_account`, `emails[]` with `primary` and `confirmed` | PayPal userinfo reference and Verify-with-PayPal sample |
| JS SDK CSP | Allow `*.paypal.com`, `*.paypalobjects.com` (and `*.venmo.com`) for script, connect, frame, child, img; nonce supported through the `data-csp-nonce` attribute | developer.paypal.com/sdk/js/csp/ |
| Render Blueprint | `runtime`, `keyvalue`, `autoDeployTrigger` (`commit`/`checksPass`/`off`), `preDeployCommand`, `dockerfilePath`/`dockerContext`/`dockerCommand`, `fromService` properties `host`/`port`/`hostport`/`connectionString`; JSON Schema at `render.com/schema/render.yaml.json` | render.com/docs/yaml-spec |
| Render free tier | Free web services spin down after 15 minutes idle and have monthly hour limits; free Postgres expires 30 days after creation (14-day grace); background workers and private services have no free tier; static sites are free | render.com/docs/free |
| pnpm deploy | On pnpm 10, `deploy` requires `inject-workspace-packages=true` unless `--legacy` is passed | pnpm.io/cli/deploy |

**Not documented by PayPal, therefore decided rather than assumed:** PKCE for Log in with PayPal (we do not use it, U3). **Process fact to plan for:** live Log in with PayPal needs PayPal's review (R2).
