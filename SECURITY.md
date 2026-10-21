# Security Policy (`SPEC.md` § 8)

## Supported Versions

| Version | Protocol Version | Supported |
|---|---|---|
| `0.1.x` | `v1` (`prepaid-usd`) | Yes (PayPal Sandbox & Mock modes) |

## Security Architecture Highlights

1. **Key Storage (`SPEC.md` § 8.1):**
   - Buyer agent keys (`hgk_<env>_...`) and seller keys (`hgs_<env>_...`) are never stored in plaintext. The database stores only an 8-character lookup prefix and `HMAC-SHA256(KEY_PEPPER, full_key)` verified in constant time via `crypto.timingSafeEqual`.
   - Ed25519 JWS signing private keys (`signing_keys` table) are encrypted at rest using `AES-256-GCM` with `MASTER_KEY` (32 bytes) and a random 96-bit IV.
2. **Token Binding & Replay Protection (`SPEC.md` §§ 4.4, 8.2):**
   - Every Ed25519 JWS payment token (`hgp_...`) is bound to `aud` (`seller_id`), `sub` (`payment_id`), `amount`, `method`, canonical `url` (including query string), `chl` (`challenge_id`), and a 60-second `exp`.
   - Redemption (`POST /v1/payments/:id/redeem`) locks the payment row (`FOR UPDATE`) and transitions `authorized -> captured` atomically, preventing double-redemption across concurrent requests.
3. **SSRF & Secret Exfiltration Prevention (`SPEC.md` § 8.2):**
   - `@haggles/client` refuses to send `Authorization: Bearer hgk_...` to any URL other than the configured `facilitatorUrl` (`InvalidChallengeError` on mismatch) and rejects private/loopback facilitator hosts (`127.0.0.0/8`, `10.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`) unless `allowInsecureLocalhost: true` is explicitly set in local development.
4. **Portal Session, CSRF & CSP (`SPEC.md` §§ 8.3, 8.6):**
   - Portal sessions use opaque 256-bit tokens (`__Host-haggles_session`, `HttpOnly; Secure; SameSite=Lax`) stored as `SHA-256` hashes in Postgres.
   - Every state-changing `/portal/v1/*` request requires both a matching `Origin` header (`PUBLIC_PORTAL_URL`) and the double-submit `X-Haggles-CSRF` header.
   - `apps/portal/proxy.ts` generates a cryptographic CSP nonce per request and whitelists only PayPal JS SDK origins (`*.paypal.com`, `*.paypalobjects.com`).
5. **Financial & Webhook Integrity (`SPEC.md` § 8.5):**
   - All money math uses signed 64-bit integer micro-dollars (`bigint`, `$1.00 = 1,000,000` micros).
   - PayPal webhooks (`POST /webhooks/paypal`) verify `paypal-transmission-sig` via PayPal's `/v1/notifications/verify-webhook-signature` endpoint on the raw request body, deduplicate by `paypal_event_id`, and re-fetch authoritative order/payout amounts from PayPal before posting to the ledger.

## Reporting a Vulnerability

Please report security vulnerabilities privately by opening a GitHub Security Advisory on the repository rather than filing a public issue. Do not include live credentials, personal data, or unredacted PayPal tokens in any report.
