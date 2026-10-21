# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-21

### Added
- **Protocol v1 (`prepaid-usd`) & `@haggles/core` (`SPEC.md` §§ 4, 6.2, 10.1):**
  - Integer micro-dollar arithmetic (`parseMoney`, `formatMoney`, `computePlatformFeeMicros`, `floorToCentsMicros`) with zero floating-point operations.
  - RFC 3986 URL canonicalization (`canonicalizeUrl`), HTTP `402` challenge/token/receipt schemas, Ed25519 JWS signing/verification, RFC 9457 error catalogue, and language-agnostic `test-vectors/*.json`.
- **Facilitator & Portal API (`@haggles/api`, `SPEC.md` §§ 5, 6, 7, 8, 9):**
  - Double-entry micro-dollar ledger (`W_AVAIL`, `W_HELD`, `S_PENDING`, `S_PAYOUT`, `G_FEES`, `G_PAYPAL`, `G_PAYPAL_FEES`) with property-based (`fast-check`), concurrency, and idempotency test suites.
  - Facilitator protocol routes (`GET /.well-known/jwks.json`, `POST /v1/payments`, `POST /v1/payments/:id/redeem`, `POST /v1/payments/:id/refund`, `GET /v1/payments/:id`, `GET /v1/wallet`).
  - PayPal integration (`PayPalGateway` Sandbox + deterministic Mock): Log in with PayPal OIDC, Orders v2 wallet top-ups, Payouts v1 seller disbursements, and verified webhook processing (`POST /webhooks/paypal`).
  - Cross-tenant IDOR protection (`404` on foreign `{id}` resources), CSRF double-submit cookies, and background worker (`apps/api/src/worker.ts`).
- **TypeScript SDKs (`@haggles/client` & `@haggles/server`, `SPEC.md` §§ 10.2, 10.3):**
  - `@haggles/client`: `createHaggles` and `readReceipt` with SSRF guard, body replay guard, and client-side ceiling enforcement.
  - `@haggles/server`: Hono (`@haggles/server/hono`) and Express (`@haggles/server/express`) paywall middleware with JWKS caching, fail-closed verification, and automatic `handler_error` refunds on `5xx`.
- **Portal UI (`@haggles/portal`, `SPEC.md` § 11):**
  - All 17 Next.js 16 routes (`/`, `/login`, `/onboarding`, `/account`, `/buy/*`, `/sell/*`, `/api/health`), WebGL2 GPGPU liquid sculpture hero, AG Grid Community data tables, and per-request CSP nonces (`proxy.ts`).
- **Demo Apps & Documentation (`examples/*`, `apps/docs`, `SPEC.md` §§ 12, 13, 14):**
  - `examples/seller-datasets` (Hono), `examples/seller-poems` (Express), and `examples/buyer-research-agent` (Vercel AI SDK + Gemini on Vertex AI).
  - Mintlify documentation site (`apps/docs/docs.json`, 17 `.mdx` pages with Mermaid diagrams, Space Grotesk font, Tabler icons, `llms.txt`, `llms-full.txt`, and `openapi.json`).
  - Multi-stage Bun Dockerfiles and root `render.yaml` Blueprint.
