/**
 * Structured documentation page definitions for `@haggles/docs` (`SPEC.md` sections 13.1 and 13.2).
 *
 * Dynamically embeds compiled TypeScript snippets from `apps/docs/snippets/`, normative test vectors
 * from `packages/core/test-vectors/`, the `ERROR_CATALOGUE` from `@haggles/core`, and route schemas
 * from the root `openapi.json`.
 */

import fs from "node:fs";
import path from "node:path";
import { ERROR_CATALOGUE, type HagglesErrorCode } from "@haggles/core";

export interface DocPage {
  slug: string;
  filename: string;
  section:
    | "Getting started"
    | "Concepts"
    | "Protocol reference"
    | "Reference"
    | "Guides"
    | "Operations"
    | "Project";
  title: string;
  description: string;
  markdown: string;
  htmlBody: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function codeBlock(code: string, lang = "ts", title?: string): string {
  const header = title
    ? `<div class="code-header"><span>${escapeHtml(title)}</span><span class="code-lang">${escapeHtml(lang)}</span></div>`
    : "";
  return `<div class="code-block">${header}<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(code.trim())}</code></pre></div>`;
}

/**
 * Loads all documentation pages (`SPEC.md` section 13.1).
 *
 * @param repoRoot - Absolute path to the repository root
 * @returns Ordered list of {@link DocPage} objects
 */
export function loadDocPages(repoRoot: string): DocPage[] {
  const snippetsDir = path.join(repoRoot, "apps/docs/snippets");
  const vectorsDir = path.join(repoRoot, "packages/core/test-vectors");
  const openapiPath = path.join(repoRoot, "openapi.json");

  const honoSnippet = fs.readFileSync(
    path.join(snippetsDir, "quickstart-sell-hono.ts"),
    "utf8",
  );
  const expressSnippet = fs.readFileSync(
    path.join(snippetsDir, "quickstart-sell-express.ts"),
    "utf8",
  );
  const buySnippet = fs.readFileSync(
    path.join(snippetsDir, "quickstart-buy.ts"),
    "utf8",
  );
  const aiToolSnippet = fs.readFileSync(
    path.join(snippetsDir, "guide-ai-sdk-tool.ts"),
    "utf8",
  );

  const moneyVectors = fs.readFileSync(
    path.join(vectorsDir, "money.json"),
    "utf8",
  );
  const urlVectors = fs.readFileSync(
    path.join(vectorsDir, "urls.json"),
    "utf8",
  );
  const challengeVectors = fs.readFileSync(
    path.join(vectorsDir, "challenges.json"),
    "utf8",
  );

  const openapiRaw = fs.readFileSync(openapiPath, "utf8");
  const openapi = JSON.parse(openapiRaw) as {
    info: { title: string; version: string; description?: string };
    paths: Record<
      string,
      Record<
        string,
        {
          tags?: string[];
          summary?: string;
          description?: string;
          responses?: Record<string, { description?: string }>;
        }
      >
    >;
  };

  const errorRowsHtml = (Object.keys(ERROR_CATALOGUE) as HagglesErrorCode[])
    .map((code) => {
      const entry = ERROR_CATALOGUE[code];
      return `<tr><td><code>${escapeHtml(code)}</code></td><td><code>${entry.status}</code></td><td>${escapeHtml(entry.title)}</td></tr>`;
    })
    .join("\n");

  const errorRowsMd = (Object.keys(ERROR_CATALOGUE) as HagglesErrorCode[])
    .map((code) => {
      const entry = ERROR_CATALOGUE[code];
      return `| \`${code}\` | ${entry.status} | ${entry.title} |`;
    })
    .join("\n");

  const openapiRowsHtml: string[] = [];
  const openapiRowsMd: string[] = [];
  for (const [routePath, methods] of Object.entries(openapi.paths)) {
    for (const [method, spec] of Object.entries(methods)) {
      const upperMethod = method.toUpperCase();
      const tag = spec.tags?.[0] ?? "general";
      const summary = spec.summary ?? spec.description ?? "";
      const statuses = Object.keys(spec.responses ?? {}).join(", ");
      openapiRowsHtml.push(
        `<tr><td><span class="method-badge method-${escapeHtml(method.toLowerCase())}">${escapeHtml(upperMethod)}</span></td><td><code>${escapeHtml(routePath)}</code></td><td><code>${escapeHtml(tag)}</code></td><td>${escapeHtml(summary)}</td><td><code>${escapeHtml(statuses)}</code></td></tr>`,
      );
      openapiRowsMd.push(
        `| \`${upperMethod}\` | \`${routePath}\` | \`${tag}\` | ${summary} | \`${statuses}\` |`,
      );
    }
  }

  return [
    {
      slug: "index",
      filename: "index.html",
      section: "Getting started",
      title: "What is Haggles?",
      description:
        "HTTP 402 Payment Required for AI agents, settled on PayPal rails with double-entry micro-dollar accounting and server-enforced spending policies.",
      markdown: `# What is Haggles?

Haggles lets any developer put a price on an HTTP endpoint ($0.0001 to $5.00 per call) and get paid in real USD via PayPal by AI agents that pay automatically within spending policies their owners control.

## End-to-End Protocol Flow

\`\`\`
Agent (@haggles/client)        Seller (@haggles/server)        Haggles Facilitator + PayPal
       |                                  |                                  |
       |--- 1. GET /datasets/rent-index ->|                                  |
       |<-- 2. 402 + Haggles-Challenge ---|                                  |
       |                                  |                                  |
       |--- 3. POST /v1/payments (agent key + challenge) ------------------->|
       |       (checks policy caps + locks W_AVAIL -> W_HELD)                |
       |<-- 4. 201 Created (signed Ed25519 JWS token) -----------------------|
       |                                  |                                  |
       |--- 5. Retry GET + Haggles-Payment: <token>                         |
       |                                  |--- 6. POST /v1/payments/:id/redeem
       |                                  |       (captures W_HELD -> S_PENDING + 5% G_FEES)
       |                                  |<-- 7. 200 OK + signed JWS receipt
       |<-- 8. 200 OK + Haggles-Receipt --|                                  |
\`\`\`

## Honest Assumptions & Known Limitations (SPEC.md §§ 1.4, 2.2, 17.1)

- **Prepaid API Credits (Assumption A1):** Paying per API call directly with PayPal Orders ($0.49 + 3.49% fee per transaction) cannot price a $0.005 or $0.02 API call economically. Buyers top up a prepaid wallet ($5–$100 via PayPal Orders v2), agents spend micro-dollars from the internal double-entry ledger, and sellers receive batched payouts via PayPal Payouts v1.
- **Regulatory Scope (Risk R3):** Holding prepaid balances and paying out third-party sellers in production can implicate stored-value or money-transmission regulations. This hackathon build operates exclusively in **PayPal Sandbox** with hard caps ($100 max top-up, $500 max wallet balance, $5 max per call).
- **Non-Goals (Section 1.4):** No blockchain, no custom token/coin, no streaming per-token billing in v1, and no public marketplace directory in v1.`,
      htmlBody: `
        <p class="lead"><strong>Haggles</strong> lets any developer put a price on an HTTP endpoint (<code>$0.0001</code> to <code>$5.00</code> per call) and get paid in USD via PayPal by AI agents that pay automatically within spending policies their owners control.</p>
        <h2>How the 402 Handshake Works</h2>
        ${codeBlock(
          `Agent (@haggles/client)        Seller (@haggles/server)        Haggles Facilitator + PayPal
       |                                  |                                  |
       |--- 1. GET /datasets/rent-index ->|                                  |
       |<-- 2. 402 + Haggles-Challenge ---|                                  |
       |                                  |                                  |
       |--- 3. POST /v1/payments (agent key + challenge) ------------------->|
       |       [enforces policy caps & locks W_AVAIL -> W_HELD]              |
       |<-- 4. 201 Created (Ed25519 JWS payment token) ----------------------|
       |                                  |                                  |
       |--- 5. Retry GET + Haggles-Payment: <token> ------------------------>|
       |                                  |--- 6. POST /v1/payments/:id/redeem
       |                                  |       [W_HELD -> S_PENDING + 5% G_FEES]
       |                                  |<-- 7. 200 OK + signed JWS receipt
       |<-- 8. 200 OK + Haggles-Receipt --|                                  |`,
          "text",
          "HTTP 402 Handshake",
        )}
        <h2>Why Prepaid Wallets + PayPal Rails? (Honesty Section)</h2>
        <div class="callout callout-info">
          <strong>Assumption A1 (Micro-payment Economics):</strong> A direct PayPal checkout on every <code>$0.005</code> API call is impossible due to per-transaction card/order fees and human checkout latency. Haggles solves this honestly: buyers fund a prepaid wallet via <strong>PayPal Orders v2</strong>, autonomous agents spend micro-dollars off a serializable double-entry Postgres ledger, and sellers receive payouts via <strong>PayPal Payouts v1</strong>.
        </div>
        <ul>
          <li><strong>Sandbox-First &amp; Regulatory Caps (Risk R3):</strong> Operating a stored-value wallet for third-party sellers in production requires money-transmission licensing or a licensed financial partner. For this hackathon, Haggles runs strictly on <strong>PayPal Sandbox</strong> with hard safety caps (<code>$5.00–$100.00</code> per top-up, <code>$500.00</code> max wallet balance, <code>$5.00</code> max per call).</li>
          <li><strong>Non-Goals (SPEC.md § 1.4):</strong> No cryptocurrency, no blockchain, no custom token, and no browser extension required. Standard HTTP headers and Ed25519 JWS tokens only.</li>
        </ul>
      `,
    },
    {
      slug: "quickstart-sell",
      filename: "quickstart-sell.html",
      section: "Getting started",
      title: "Quickstart: Sell (5 minutes)",
      description:
        "Monetize any Hono or Express route in 2 lines of middleware and get paid via PayPal Payouts.",
      markdown: `# Quickstart: Sell (5 minutes)

1. Sign in to the Haggles Portal with your PayPal account (which automatically registers your PayPal \`payer_id\` for payouts).
2. Open **Sell -> Setup** and create a seller key (\`hgs_test_...\`).
3. Install \`@haggles/server\` and add the \`paywall\` middleware to your Hono or Express route:

## Hono Seller Example

\`\`\`ts
${honoSnippet.trim()}
\`\`\`

## Express Seller Example

\`\`\`ts
${expressSnippet.trim()}
\`\`\``,
      htmlBody: `
        <p class="lead">Gate any Hono or Express route behind HTTP <code>402 Payment Required</code> in under 5 minutes.</p>
        <ol>
          <li><strong>Sign in with PayPal:</strong> Open <code>/login</code> in the Haggles Portal. Signing in via PayPal OIDC automatically records your verified <code>payer_id</code> for PayPal Payouts v1.</li>
          <li><strong>Create a Seller Key:</strong> Go to <strong>Sell &rarr; Setup</strong> and generate your <code>HAGGLES_SELLER_KEY</code> (<code>hgs_test_...</code>) and copy your <code>sellerId</code> (<code>slr_...</code>).</li>
          <li><strong>Install the middleware:</strong> <code>bun add @haggles/server</code></li>
        </ol>
        <h2>Hono Middleware (Compiled Snippet)</h2>
        ${codeBlock(honoSnippet, "ts", "apps/docs/snippets/quickstart-sell-hono.ts")}
        <h2>Express Middleware (Compiled Snippet)</h2>
        ${codeBlock(expressSnippet, "ts", "apps/docs/snippets/quickstart-sell-express.ts")}
      `,
    },
    {
      slug: "quickstart-buy",
      filename: "quickstart-buy.html",
      section: "Getting started",
      title: "Quickstart: Buy (5 minutes)",
      description:
        "Fund a prepaid wallet with PayPal Orders v2, issue a policy-capped agent key, and call paid endpoints with createHaggles.",
      markdown: `# Quickstart: Buy (5 minutes)

1. Open **Buy -> Wallet** in the Haggles Portal and add \`$5.00\`–\`$100.00\` using PayPal Sandbox.
2. Open **Buy -> Agent keys** and create a key (\`hgk_test_...\`) with a per-call cap (e.g. \`$0.10\`) and daily cap (e.g. \`$5.00\`).
3. Wrap \`fetch\` with \`createHaggles\` from \`@haggles/client\`:

\`\`\`ts
${buySnippet.trim()}
\`\`\``,
      htmlBody: `
        <p class="lead">Give any Node.js, Bun, or AI SDK agent a drop-in <code>fetch</code> that pays HTTP <code>402</code> challenges within your spending policy.</p>
        <ol>
          <li><strong>Add funds:</strong> Open <strong>Buy &rarr; Wallet</strong> and top up <code>$5.00</code>–<code>$100.00</code> via PayPal Orders v2.</li>
          <li><strong>Create an Agent Key:</strong> Open <strong>Buy &rarr; Agent keys</strong>, set your per-call and daily spending caps, and copy your <code>HAGGLES_KEY</code> (<code>hgk_test_...</code>) from the show-once dialog.</li>
          <li><strong>Call paid endpoints:</strong> Install <code>bun add @haggles/client</code> and use <code>createHaggles</code>:</li>
        </ol>
        ${codeBlock(buySnippet, "ts", "apps/docs/snippets/quickstart-buy.ts")}
      `,
    },
    {
      slug: "concepts-ledger",
      filename: "concepts-ledger.html",
      section: "Concepts",
      title: "Prepaid Wallets & Double-Entry Ledger",
      description:
        "How Haggles tracks every micro-dollar ($0.000001) across 6 double-entry account kinds with zero floating-point math.",
      markdown: `# Prepaid Wallets & Double-Entry Ledger (SPEC.md § 6)

All money inside Haggles is stored as signed 64-bit integer **micro-dollars** (\`1 USD = 1,000,000 micros\`). Floating-point numbers are forbidden for money across the entire codebase.

## The Six Ledger Account Kinds

| Account Kind | Normal Side | Guarded (\`>= 0\`) | Purpose |
|---|---|---|---|
| \`G_PAYPAL\` | Debit (Asset) | No | PayPal omnibus clearing balance |
| \`G_PAYPAL_FEES\` | Debit (Expense) | No | PayPal Orders & Payouts processing fees |
| \`W_AVAIL\` | Credit (Liability) | **Yes** | Buyer wallet available balance |
| \`W_HELD\` | Credit (Liability) | **Yes** | Buyer wallet funds locked in 60s flight holds |
| \`S_PENDING\` | Credit (Liability) | **Yes** | Seller net earnings awaiting payout |
| \`S_PAYOUT\` | Credit (Liability) | **Yes** | Seller whole-cent earnings in an active PayPal Payout batch |
| \`G_FEES\` | Credit (Revenue) | No | Haggles 5% facilitator revenue (\`PLATFORM_FEE_BPS = 500\`) |

## Global Conservation Invariant

Every ledger transaction is enforced by a PostgreSQL \`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED\` verifying \`SUM(debit) == SUM(credit)\` before commit, and an hourly invariant check verifies:

\`G_PAYPAL + G_PAYPAL_FEES == sum(W_AVAIL) + sum(W_HELD) + sum(S_PENDING) + sum(S_PAYOUT) + G_FEES\``,
      htmlBody: `
        <p class="lead">All monetary values in Haggles are represented as integer <strong>micro-dollars</strong> (<code>$1.00 = 1,000,000 micros</code>). Floating-point numbers are never used for money.</p>
        <h2>Ledger Account Kinds (SPEC.md § 6.2)</h2>
        <table>
          <thead><tr><th>Account Kind</th><th>Normal Balance</th><th>Non-Negative Guard</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>G_PAYPAL</code></td><td>Debit (Asset)</td><td>No</td><td>PayPal omnibus cash clearing account</td></tr>
            <tr><td><code>G_PAYPAL_FEES</code></td><td>Debit (Expense)</td><td>No</td><td>PayPal processing fee expense account</td></tr>
            <tr><td><code>W_AVAIL</code></td><td>Credit (Liability)</td><td><strong>Yes</strong></td><td>Buyer wallet available balance ready for agent spend</td></tr>
            <tr><td><code>W_HELD</code></td><td>Credit (Liability)</td><td><strong>Yes</strong></td><td>Buyer funds locked in active 60-second payment authorizations</td></tr>
            <tr><td><code>S_PENDING</code></td><td>Credit (Liability)</td><td><strong>Yes</strong></td><td>Seller net earnings (95%) including sub-cent micro-dollar dust</td></tr>
            <tr><td><code>S_PAYOUT</code></td><td>Credit (Liability)</td><td><strong>Yes</strong></td><td>Seller whole-cent funds currently in flight via PayPal Payouts v1</td></tr>
            <tr><td><code>G_FEES</code></td><td>Credit (Revenue)</td><td>No</td><td>Haggles platform fee revenue (default 5% = 500 bps, rounded half-even)</td></tr>
          </tbody>
        </table>
        <h2>The Six Atomic Posting Plans (SPEC.md § 6.2)</h2>
        <ol>
          <li><strong>Top-up Capture:</strong> Debit <code>G_PAYPAL</code> (net) + Debit <code>G_PAYPAL_FEES</code> (fee) &rarr; Credit <code>W_AVAIL</code> (gross).</li>
          <li><strong>Authorize (Hold):</strong> Debit <code>W_AVAIL</code> &rarr; Credit <code>W_HELD</code>.</li>
          <li><strong>Redeem (Capture):</strong> Debit <code>W_HELD</code> (gross) &rarr; Credit <code>S_PENDING</code> (95% net) + Credit <code>G_FEES</code> (5% fee).</li>
          <li><strong>Release / Hold Expiry:</strong> Debit <code>W_HELD</code> &rarr; Credit <code>W_AVAIL</code>.</li>
          <li><strong>Refund (&lt; 24 h):</strong> Debit <code>S_PENDING</code> (net) + Debit <code>G_FEES</code> (fee) &rarr; Credit <code>W_AVAIL</code> (gross).</li>
          <li><strong>Payout Request &amp; Settlement:</strong> Debit <code>S_PENDING</code> &rarr; Credit <code>S_PAYOUT</code>, then on webhook <code>SUCCEEDED</code>: Debit <code>S_PAYOUT</code> &rarr; Credit <code>G_PAYPAL</code>.</li>
        </ol>
      `,
    },
    {
      slug: "concepts-policies",
      filename: "concepts-policies.html",
      section: "Concepts",
      title: "Spending Policies",
      description:
        "Server-enforced per-call, daily, monthly, host, and seller guardrails for autonomous AI agents.",
      markdown: `# Spending Policies (SPEC.md § 5.3)

Every buyer agent key (\`hgk_<env>_...\`) carries a server-enforced spending policy evaluated inside the same serializable transaction that locks \`W_AVAIL\`:

1. **Key Status & Expiry:** Must be \`active\` and \`now < expires_at\`.
2. **Allowed Sellers (\`allowed_sellers\`):** If non-empty, \`challenge.seller_id\` must be in the list.
3. **Allowed Hosts (\`allowed_hosts\`):** If non-empty, the canonicalized lowercase hostname of \`challenge.url\` must match.
4. **Per-Call Maximum (\`per_call_max\`):** \`challenge.amount <= per_call_max\` (default \`$0.10\`).
5. **Daily Maximum (\`daily_max\`):** UTC day counter \`spent_today + amount <= daily_max\` (default \`$5.00\`).
6. **Monthly Maximum (\`monthly_max\`):** Optional UTC month counter \`spent_month + amount <= monthly_max\`.`,
      htmlBody: `
        <p class="lead">Agent keys are never unconstrained wallet bearers. Every <code>POST /v1/payments</code> call evaluates 6 deterministic policy rules before locking a single micro-dollar.</p>
        <table>
          <thead><tr><th>Order</th><th>Rule</th><th>Failure Code</th><th>RFC 9457 Detail</th></tr></thead>
          <tbody>
            <tr><td>1</td><td>Key status &amp; <code>expires_at</code></td><td><code>401 key_revoked</code></td><td>API key has been revoked or expired</td></tr>
            <tr><td>2</td><td><code>allowed_sellers</code> allowlist</td><td><code>403 policy_violation</code></td><td><code>seller_not_allowed</code></td></tr>
            <tr><td>3</td><td><code>allowed_hosts</code> allowlist</td><td><code>403 policy_violation</code></td><td><code>host_not_allowed</code></td></tr>
            <tr><td>4</td><td><code>per_call_max</code> cap</td><td><code>403 policy_violation</code></td><td><code>per_call_max_exceeded</code></td></tr>
            <tr><td>5</td><td><code>daily_max</code> UTC day cap</td><td><code>403 policy_violation</code></td><td><code>daily_max_exceeded</code></td></tr>
            <tr><td>6</td><td><code>monthly_max</code> UTC month cap</td><td><code>403 policy_violation</code></td><td><code>monthly_max_exceeded</code></td></tr>
          </tbody>
        </table>
      `,
    },
    {
      slug: "concepts-lifecycle",
      filename: "concepts-lifecycle.html",
      section: "Concepts",
      title: "Payments Lifecycle",
      description:
        "State machine for authorized, captured, released, and refunded HTTP 402 payments.",
      markdown: `# Payments Lifecycle (SPEC.md § 4 & § 6)

\`\`\`
                 +---> captured ---> refunded (within 24 h)
                 |
[new] -> authorized (60 s TTL)
                 |
                 +---> released (explicit /v1/release or 60 s expiry job)
\`\`\`

- **Hold TTL (60 seconds):** When \`POST /v1/payments\` succeeds, funds move from \`W_AVAIL\` to \`W_HELD\` and \`spent_today\` / \`spent_month\` are incremented. If the seller does not redeem the token within 60 seconds, the hold expires and both the balance and policy counters are restored.
- **Auto-Release & Auto-Refund:** If a seller handler throws or returns \`HTTP >= 500\` after redeem, \`@haggles/server\` automatically calls \`POST /v1/payments/:id/refund\` in the background.`,
      htmlBody: `
        <p class="lead">Every payment transitions through a strict state machine backed by idempotent ledger postings.</p>
        ${codeBlock(
          `                 +---> captured ---> refunded (within 24 h window)
                 |
[new] -> authorized (60 s hold TTL)
                 |
                 +---> released (seller /release or 60 s expiry worker)`,
          "text",
          "Payment State Machine",
        )}
        <ul>
          <li><strong>Authorized (<code>W_AVAIL &rarr; W_HELD</code>):</strong> Holds funds for 60 seconds and reserves daily/monthly policy budget.</li>
          <li><strong>Captured (<code>W_HELD &rarr; S_PENDING + G_FEES</code>):</strong> Triggered when the seller middleware calls <code>POST /v1/payments/:id/redeem</code>. Emits a signed Ed25519 JWS <code>Haggles-Receipt</code>.</li>
          <li><strong>Released (<code>W_HELD &rarr; W_AVAIL</code>):</strong> Restores held funds and decrements daily/monthly spend counters if the call was not fulfilled.</li>
          <li><strong>Refunded (<code>S_PENDING + G_FEES &rarr; W_AVAIL</code>):</strong> Full-amount reversal available within 24 hours of capture.</li>
        </ul>
      `,
    },
    {
      slug: "concepts-security",
      filename: "concepts-security.html",
      section: "Concepts",
      title: "Security Model",
      description:
        "Cryptographic key storage, Ed25519 JWS tokens, SSRF prevention, CSRF double-submit cookies, and PayPal CSP nonces.",
      markdown: `# Security Model (SPEC.md § 8)

| Threat | Mitigation |
|---|---|
| Database read leak of API keys | Keys are hashed with \`HMAC-SHA256(KEY_PEPPER, fullKey)\` and compared via \`crypto.timingSafeEqual\`. Plaintext is shown once on creation. |
| Signing key compromise at rest | Ed25519 private keys in \`signing_keys\` are encrypted with \`AES-256-GCM\` using a random 96-bit IV and 32-byte \`MASTER_KEY\`. |
| Token replay or cross-endpoint reuse | Every JWS payment token binds \`aud\` (\`seller_id\`), \`mth\` (HTTP method), \`url\` (canonical URL), \`amt\` (micro-dollars), and a 60-second \`exp\`. |
| Facilitator SSRF | The facilitator **never** makes outbound HTTP requests to seller URLs; URLs are treated purely as canonicalized strings. |
| Portal CSRF | Session cookie \`hg_session\` (\`HttpOnly; Secure; SameSite=Lax\`) paired with \`hg_csrf\` and required \`X-Haggles-CSRF\` header + \`Origin\` check on all mutations. |
| PayPal Webhook Spoofing | Raw body verified against PayPal's \`POST /v1/notifications/verify-webhook-signature\` before processing, deduplicated in \`webhook_events\`. |`,
      htmlBody: `
        <p class="lead">Defense-in-depth controls across key storage, token cryptography, webhook verification, and browser security headers (SPEC.md § 8).</p>
        <table>
          <thead><tr><th>Threat Vector</th><th>Control Implemented</th></tr></thead>
          <tbody>
            <tr><td>API Key DB Leak</td><td><code>HMAC-SHA256(KEY_PEPPER, key)</code> + <code>timingSafeEqual</code>; only prefix stored in plaintext</td></tr>
            <tr><td>Signing Key at Rest</td><td>Ed25519 JWS keys encrypted with <code>AES-256-GCM</code> under <code>MASTER_KEY</code></td></tr>
            <tr><td>Token Replay / Tampering</td><td>Ed25519 JWS binds <code>sub</code> (<code>payment_id</code>), <code>aud</code> (<code>seller_id</code>), <code>mth</code>, canonical <code>url</code>, <code>amt</code>, and 60s <code>exp</code></td></tr>
            <tr><td>Facilitator SSRF</td><td>Facilitator never fetches seller URLs; all HTTP calls flow directly between buyer and seller</td></tr>
            <tr><td>Portal CSRF &amp; IDOR</td><td><code>X-Haggles-CSRF</code> double-submit cookie + <code>Origin</code> verification + tenant-scoped queries returning <code>404</code> on cross-tenant IDs</td></tr>
            <tr><td>PayPal JS SDK XSS / CSP</td><td>Per-response cryptographic nonce in Next.js 16 <code>proxy.ts</code> with strict PayPal domain allowlist</td></tr>
          </tbody>
        </table>
      `,
    },
    {
      slug: "protocol-wire",
      filename: "protocol-wire.html",
      section: "Protocol reference",
      title: "Headers, Challenge, Token & Receipt",
      description:
        "Normative wire protocol headers, URL canonicalization rules, JWS claims, and test vectors (SPEC.md § 4).",
      markdown: `# Wire Protocol Reference (SPEC.md § 4)

## HTTP Headers

- \`WWW-Authenticate: Haggles challenge="<base64url(JSON)>"\`
- \`Haggles-Challenge: <base64url(JSON)>\`
- \`Haggles-Payment: <compact Ed25519 JWS token>\`
- \`Haggles-Receipt: <compact Ed25519 JWS receipt>\`

## Normative Money Test Vectors (\`packages/core/test-vectors/money.json\`)

\`\`\`json
${moneyVectors.trim()}
\`\`\`

## Normative URL Canonicalization Vectors (\`packages/core/test-vectors/urls.json\`)

\`\`\`json
${urlVectors.trim()}
\`\`\``,
      htmlBody: `
        <p class="lead">Normative wire format for HTTP <code>402 Payment Required</code> challenges, Ed25519 JWS payment tokens, and receipts (SPEC.md § 4).</p>
        <h2>HTTP Headers</h2>
        <ul>
          <li><code>WWW-Authenticate: Haggles challenge="&lt;base64url&gt;"</code> — Standard RFC 9110 challenge header on <code>402</code> responses.</li>
          <li><code>Haggles-Challenge: &lt;base64url&gt;</code> — Convenience header containing the same base64url-encoded JSON challenge.</li>
          <li><code>Haggles-Payment: &lt;JWS&gt;</code> — Sent by the buyer on the retried request.</li>
          <li><code>Haggles-Receipt: &lt;JWS&gt;</code> — Returned by the seller on the fulfilled <code>2xx</code> response.</li>
        </ul>
        <h2>Normative Money Vectors (<code>packages/core/test-vectors/money.json</code>)</h2>
        ${codeBlock(moneyVectors, "json", "packages/core/test-vectors/money.json")}
        <h2>Normative URL Canonicalization Vectors (<code>packages/core/test-vectors/urls.json</code>)</h2>
        ${codeBlock(urlVectors, "json", "packages/core/test-vectors/urls.json")}
        <h2>Normative Challenge Vectors (<code>packages/core/test-vectors/challenges.json</code>)</h2>
        ${codeBlock(challengeVectors, "json", "packages/core/test-vectors/challenges.json")}
      `,
    },
    {
      slug: "protocol-errors",
      filename: "protocol-errors.html",
      section: "Protocol reference",
      title: "Error Catalogue (RFC 9457)",
      description:
        "Complete machine-readable error code catalogue returned in application/problem+json responses (SPEC.md Appendix A).",
      markdown: `# Error Catalogue — RFC 9457 Problem Details (SPEC.md Appendix A)

Every facilitator and middleware error returns \`Content-Type: application/problem+json\` with \`type\`, \`title\`, \`status\`, \`code\`, \`detail\`, and \`request_id\`.

| \`code\` | HTTP Status | Title |
|---|---|---|
${errorRowsMd}`,
      htmlBody: `
        <p class="lead">All API and middleware errors use RFC 9457 Problem Details (<code>application/problem+json</code>). Generated directly from <code>ERROR_CATALOGUE</code> in <code>@haggles/core</code>.</p>
        <table>
          <thead><tr><th>Error Code (<code>code</code>)</th><th>HTTP Status</th><th>RFC 9457 Title</th></tr></thead>
          <tbody>${errorRowsHtml}</tbody>
        </table>
      `,
    },
    {
      slug: "api-reference",
      filename: "api-reference.html",
      section: "Reference",
      title: "API Reference (OpenAPI 3.1)",
      description:
        "Complete Facilitator (/v1/*) and Portal (/portal/v1/*) HTTP endpoint reference generated from openapi.json.",
      markdown: `# Facilitator & Portal API Reference (${openapi.info.title} v${openapi.info.version})

Download the raw specification: [\`/openapi.json\`](./openapi.json)

| Method | Path | Tag | Summary | Responses |
|---|---|---|---|---|
${openapiRowsMd.join("\n")}`,
      htmlBody: `
        <p class="lead">Generated directly from the repository's <a href="./openapi.json"><code>openapi.json</code></a> specification (${escapeHtml(openapi.info.title)} v${escapeHtml(openapi.info.version)}).</p>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Tag</th><th>Summary</th><th>Responses</th></tr></thead>
          <tbody>${openapiRowsHtml.join("\n")}</tbody>
        </table>
      `,
    },
    {
      slug: "sdk-reference",
      filename: "sdk-reference.html",
      section: "Reference",
      title: "SDK Reference (@haggles/*)",
      description:
        "TypeScript reference for @haggles/core, @haggles/client, and @haggles/server.",
      markdown: `# SDK Reference

## \`@haggles/core\`
- \`parseMoney(input: string): bigint\` — Parses a USD decimal string into integer micro-dollars (\`1_000_000n\` = \`$1.00\`).
- \`formatMoney(micros: bigint): string\` — Formats integer micro-dollars into canonical USD decimal string (min 2 decimals, up to 6).
- \`canonicalizeUrl(rawUrl: string): string\` — Normalizes scheme/host case, strips default ports and fragments, and sorts query parameters.
- \`encodeChallenge(challenge: Challenge): string\` / \`decodeChallenge(encoded: string): Challenge\`
- \`signPaymentToken(claims, privateKey, kid)\` / \`verifyPaymentToken(token, jwks, expected)\`
- \`signReceipt(claims, privateKey, kid)\` / \`verifyReceipt(receipt, jwks)\`

## \`@haggles/client\`
- \`createHaggles(options: CreateHagglesOptions): HagglesClient\` — Returns \`{ fetch, balance, wrap }\`.
- \`readReceipt(response: Response): HagglesReceipt | null\` — Decodes the \`Haggles-Receipt\` header from a paid response.

## \`@haggles/server\`
- \`paywall(config: PaywallConfig)\` in \`@haggles/server/hono\` and \`@haggles/server/express\`
- \`createPaywallCore(config: PaywallConfig)\` — Framework-agnostic 402 challenge & redeem engine with fail-closed verification and automatic 5xx refund.`,
      htmlBody: `
        <p class="lead">TypeScript SDK reference for <code>@haggles/core</code>, <code>@haggles/client</code>, and <code>@haggles/server</code> (ESM + CJS + strict <code>.d.ts</code>).</p>
        <h2><code>@haggles/core</code></h2>
        <ul>
          <li><code>parseMoney(input: string): bigint</code> — Converts a USD decimal string (e.g. <code>"0.025"</code>) into integer micro-dollars (<code>25_000n</code>). Rejects floats, negatives, and &gt; 6 decimal places.</li>
          <li><code>formatMoney(micros: bigint): string</code> — Formats integer micro-dollars into a canonical USD string (minimum 2 fractional digits, up to 6).</li>
          <li><code>canonicalizeUrl(rawUrl: string): string</code> — RFC 3986 normalization used to bind tokens to exact request targets.</li>
          <li><code>signPaymentToken</code> / <code>verifyPaymentToken</code> / <code>signReceipt</code> / <code>verifyReceipt</code> — Ed25519 JWS helpers.</li>
        </ul>
        <h2><code>@haggles/client</code></h2>
        <ul>
          <li><code>createHaggles(options: CreateHagglesOptions): HagglesClient</code> — Creates a buyer client with <code>fetch</code>, <code>balance()</code>, and <code>wrap(baseFetch)</code>.</li>
          <li><code>readReceipt(response: Response): HagglesReceipt | null</code> — Reads and parses the seller's <code>Haggles-Receipt</code> header.</li>
        </ul>
        <h2><code>@haggles/server</code></h2>
        <ul>
          <li><code>@haggles/server/hono</code> — <code>paywall(config)({ price, description, route })</code> middleware for Hono.</li>
          <li><code>@haggles/server/express</code> — <code>paywall(config)({ price, description, route })</code> middleware for Express 4/5.</li>
        </ul>
      `,
    },
    {
      slug: "guides-paywall",
      filename: "guides-paywall.html",
      section: "Guides",
      title: "Paywall an Express or Hono API",
      description:
        "How @haggles/server validates route prices at startup, verifies tokens locally against JWKS, and auto-refunds on 5xx errors.",
      markdown: `# Guide: Paywall an Express or Hono API

\`@haggles/server\` validates route prices at startup (failing fast if a price is outside \`$0.0001\`..\`$5.00\`), verifies Ed25519 JWS tokens locally against the facilitator's cached JWKS before calling \`POST /v1/payments/:id/redeem\`, and automatically triggers \`POST /v1/payments/:id/refund\` if your downstream route handler throws or responds with HTTP \`>= 500\`.

\`\`\`ts
${honoSnippet.trim()}
\`\`\``,
      htmlBody: `
        <p class="lead">Learn how <code>@haggles/server</code> protects your API routes with startup price validation, local Ed25519 JWKS pre-verification, and automatic refunds if your handler fails.</p>
        <h2>Startup Validation &amp; Auto-Refund Behavior</h2>
        <ul>
          <li><strong>Fail-Fast Price Check:</strong> Passing <code>price: "0.00"</code> or <code>price: "9.99"</code> throws <code>InvalidMoneyError</code> at server startup so misconfigured routes never boot silently.</li>
          <li><strong>Fail-Closed Verification:</strong> If the facilitator is unreachable, the middleware returns <code>503 Service Unavailable</code> with <code>Retry-After: 5</code> and never serves paid data unpaid.</li>
          <li><strong>Automatic 5xx Refund:</strong> When <code>refundOnError: true</code> (default), if your route handler throws an exception or returns status <code>&gt;= 500</code> after redeem, the middleware asynchronously calls <code>POST /v1/payments/:id/refund</code> so the buyer is never charged for a server error.</li>
        </ul>
        ${codeBlock(honoSnippet, "ts", "apps/docs/snippets/quickstart-sell-hono.ts")}
      `,
    },
    {
      slug: "guides-ai-agent",
      filename: "guides-ai-agent.html",
      section: "Guides",
      title: "Give an AI SDK Agent a Paid-Fetch Tool",
      description:
        "Equip a Vercel AI SDK + Gemini Vertex AI agent with a Haggles paid-fetch tool and surface policy guardrails.",
      markdown: `# Guide: Give an AI SDK Agent a Paid-Fetch Tool

Wrap \`haggles.fetch\` inside a Vercel AI SDK \`tool()\` so Gemini (via \`@ai-sdk/google-vertex\`) can autonomously purchase metered HTTP 402 data within your key's policy limits:

\`\`\`ts
${aiToolSnippet.trim()}
\`\`\``,
      htmlBody: `
        <p class="lead">Equip a Vercel AI SDK agent (Gemini on Vertex AI) with a <code>buy_source</code> tool backed by <code>@haggles/client</code>.</p>
        ${codeBlock(aiToolSnippet, "ts", "apps/docs/snippets/guide-ai-sdk-tool.ts")}
        <p>See the full working implementation in <code>examples/buyer-research-agent</code>, which pairs Gemini tool calling with a real-time <strong>Spend Panel</strong> and an on-demand policy-hit guardrail trigger.</p>
      `,
    },
    {
      slug: "guides-production",
      filename: "guides-production.html",
      section: "Guides",
      title: "Going to Production",
      description:
        "Checklist for moving beyond the PayPal Sandbox hackathon environment, including regulatory review (R3) and PayPal live app approval (R2).",
      markdown: `# Going to Production Checklist (SPEC.md § 13.1 & § 17.1)

1. **Regulatory & Stored-Value Review (Risk R3):** Holding prepaid balances on behalf of buyers and disbursing payouts to third-party sellers in production may constitute money transmission or stored-value issuance depending on jurisdiction. Before enabling \`PAYPAL_MODE=live\`, obtain legal counsel or partner with a licensed financial institution / payment facilitator.
2. **PayPal Live App Approval (Risk R2):** Live *Log in with PayPal* scopes (\`openid\`, \`email\`, \`https://uri.paypal.com/services/paypalattributes\`) and Live *PayPal Payouts* require account-level approval from PayPal.
3. **Separate Per-Environment Webhook IDs:** Register a dedicated live webhook in the PayPal Developer Dashboard and set \`PAYPAL_WEBHOOK_ID\` for that environment.
4. **Always-On Infrastructure (Risk R5):** Run \`haggles-api\`, \`haggles-worker\`, \`haggles-portal\`, and PostgreSQL 16 on paid always-on instances so cold starts or 30-day free DB expirations never interrupt traffic.`,
      htmlBody: `
        <p class="lead">What is required to take Haggles from the PayPal Sandbox hackathon environment to a production deployment (SPEC.md § 17.1).</p>
        <div class="callout callout-warn">
          <strong>Regulatory Notice (Risk R3):</strong> This repository is a sandbox prototype built for the PayPal + AI Hackathon. Holding prepaid balances and settling third-party seller payouts in live USD may require money-transmission licensing or a licensed banking/payment partner.
        </div>
        <ol>
          <li><strong>Legal &amp; Licensing Review (R3):</strong> Complete regulatory review for stored value / money transmission before enabling <code>PAYPAL_MODE=live</code>.</li>
          <li><strong>PayPal Live Scope Approval (R2):</strong> Submit your PayPal REST application for live review of <em>Log in with PayPal</em> (<code>paypalattributes</code> scope for <code>payer_id</code>) and live <em>Payouts v1</em>.</li>
          <li><strong>Key Management:</strong> Store <code>MASTER_KEY</code> and <code>KEY_PEPPER</code> in a secret manager and schedule 30-day Ed25519 JWKS key rotations.</li>
          <li><strong>Paid Always-On Hosting (R5):</strong> Use paid Render plans for web services, worker, and PostgreSQL 16 (free Render Postgres databases expire after 30 days).</li>
        </ol>
      `,
    },
    {
      slug: "ops-self-hosting",
      filename: "ops-self-hosting.html",
      section: "Operations",
      title: "Self-Hosting the Facilitator",
      description:
        "Run Haggles locally with Docker Compose or deploy to Render with the root render.yaml Blueprint.",
      markdown: `# Self-Hosting the Facilitator (SPEC.md § 14)

## Local Development with Docker Compose & Bun

\`\`\`bash
docker compose up -d          # Starts PostgreSQL 16 + Redis 7
bun install
bun run db:migrate            # Applies Drizzle SQL migrations + deferred ledger trigger
bun run seed                  # Seeds demo buyer wallet ($25), 2 sellers, and sample payments
bun run dev                   # Starts the portal and API
\`\`\`

## Deploying on Render (\`render.yaml\`)

The repository root includes a schema-validated \`render.yaml\` Blueprint provisioning PostgreSQL 16 (\`haggles-db\`), Redis (\`haggles-kv\`), \`haggles-api\`, \`haggles-worker\`, \`haggles-portal\`, \`haggles-docs\`, and the three demo services.`,
      htmlBody: `
        <p class="lead">Run the entire Haggles stack locally in under 2 minutes with Docker Compose and Bun, or deploy to Render via the root <code>render.yaml</code> Blueprint.</p>
        ${codeBlock(
          `docker compose up -d          # Starts Postgres 16 + Redis 7
bun install
bun run db:migrate            # Applies 17 tables + deferred double-entry balance trigger
bun run seed                  # Seeds buyer wallet ($25), 2 sellers, and sample payments
bun run dev:api               # Starts Facilitator API on http://localhost:3001
bun run dev:portal            # Starts Next.js Portal on http://localhost:3000`,
          "bash",
          "Local Startup",
        )}
      `,
    },
    {
      slug: "ops-runbook",
      filename: "ops-runbook.html",
      section: "Operations",
      title: "Backups, Rotating Keys & Incident Basics",
      description:
        "Operational runbook for Ed25519 JWKS rotation, seller key rotation, and ledger invariant incidents.",
      markdown: `# Operational Runbook (SPEC.md § 9 & § 13.1)

## Rotating Ed25519 JWS Signing Keys
The facilitator supports multiple active/verify-only keys in \`/.well-known/jwks.json\`. When rotating:
1. Insert a new \`active\` Ed25519 key (encrypted under \`MASTER_KEY\`).
2. Transition the previous key to \`verify_only\` for at least 10 minutes (well beyond the 60-second payment token TTL) so in-flight tokens verify cleanly.
3. Retire expired keys.

## Zero-Downtime Seller Key Rotation
Sellers can hold up to **2 active seller keys** (\`hgs_<env>_...\`) simultaneously. Create a second key in **Sell -> Seller keys**, deploy the new \`HAGGLES_SELLER_KEY\` to your servers, and then revoke the old key.

## Handling Ledger Invariant or Chargeback Alerts
- If PayPal sends \`PAYMENT.CAPTURE.REVERSED\`, the webhook handler posts a compensating entry and sets \`wallets.status = 'frozen'\`, immediately blocking new \`POST /v1/payments\` authorizations for that buyer.`,
      htmlBody: `
        <p class="lead">Runbook for zero-downtime key rotation, PayPal reversal handling, and hourly ledger invariant checks.</p>
        <h2>Ed25519 Signing Key Rotation</h2>
        <p><code>GET /.well-known/jwks.json</code> serves all <code>active</code> and <code>verify_only</code> public keys with <code>Cache-Control: public, max-age=300</code>. Keep rotated keys in <code>verify_only</code> state for at least 10 minutes before retiring.</p>
        <h2>Zero-Downtime Seller Key Rotation</h2>
        <p>Each seller account may hold up to <strong>2 active keys</strong> at once. Provision key #2 in <strong>Sell &rarr; Seller keys</strong>, roll your middleware deployment, then revoke key #1.</p>
      `,
    },
    {
      slug: "faq",
      filename: "faq.html",
      section: "Project",
      title: "FAQ · Changelog · Contributing",
      description:
        "Frequently asked questions, release changelog, and contribution guidelines.",
      markdown: `# FAQ · Changelog · Contributing

## FAQ

**Why not charge PayPal on every API call?**
PayPal Orders have fixed + percentage transaction fees and require human approval. Pre-funding a wallet ($5–$100) via PayPal Orders v2 lets AI agents make sub-cent ($0.005) HTTP 402 calls in milliseconds with zero per-call PayPal fee.

**What happens if a seller's server crashes after redeeming a token?**
\`@haggles/server\` catches unhandled exceptions and \`HTTP >= 500\` responses and automatically triggers an asynchronous full refund (\`POST /v1/payments/:id/refund\`), restoring the buyer's wallet balance and reversing the 5% platform fee.

**How are sub-cent balances paid out to sellers?**
PayPal Payouts v1 requires whole-cent USD amounts (\`$0.01\` increments). Haggles sweeps the largest whole-cent amount (\`>= $1.00\`) from \`S_PENDING\` to \`S_PAYOUT\` and leaves any sub-cent dust (\`< $0.01\`) in \`S_PENDING\` for the next payout.`,
      htmlBody: `
        <h2>Frequently Asked Questions</h2>
        <dl>
          <dt><strong>Why not charge PayPal on every API call?</strong></dt>
          <dd>PayPal Orders require human approval and carry per-transaction fees that exceed the price of a <code>$0.005</code> API call. Pre-funding a wallet via PayPal Orders v2 lets agents settle micro-dollar calls in milliseconds on the internal double-entry ledger, while sellers cash out via PayPal Payouts v1.</dd>
          <dt><strong>What happens if a seller's endpoint returns 500 after redeeming a payment?</strong></dt>
          <dd><code>@haggles/server</code> automatically invokes <code>POST /v1/payments/:id/refund</code>, reversing both the seller's 95% share and Haggles's 5% fee back to the buyer's <code>W_AVAIL</code> balance.</dd>
          <dt><strong>How is sub-cent micro-dollar dust handled on payouts?</strong></dt>
          <dd>PayPal Payouts v1 accepts 2-decimal cent amounts. Payout sweeps transfer <code>floor(pending / 10_000) * 10_000</code> micros and leave sub-cent dust (<code>&lt; $0.01</code>) in <code>S_PENDING</code>.</dd>
        </dl>
      `,
    },
  ];
}
