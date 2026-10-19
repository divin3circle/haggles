#!/usr/bin/env bun
/**
 * Haggles M0 PayPal sandbox smoke test (SPEC.md sections 2.4, 7.1, 7.2, 8.5, Appendix C).
 *
 * Usage: bun scripts/paypal-smoke.ts <token|order|payout|verify-webhook> [args]
 *
 * Zero external dependencies: global fetch plus node: builtins only.
 * NEVER prints secrets: tokens are masked to their first 8 characters.
 * Config comes from PAYPAL_* env vars, loaded from the repo-root .env if present.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const BASE_URL = "https://api-m.sandbox.paypal.com";
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOKEN_CACHE_PATH = `${REPO_ROOT}.paypal-token.json`;
/** Re-request a token this long before its stated expiry (SPEC 7.1: refresh before expiry). */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const PAYOUT_POLL_INTERVAL_MS = 5_000;
const PAYOUT_POLL_TIMEOUT_MS = 180_000;

/** Minimal JSON helpers so no PayPal response field is ever typed as `any`. */
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Masks a secret to its first 8 characters; the full value is never printable from here. */
function mask(secret: string): string {
  return secret.length <= 8 ? "********" : `${secret.slice(0, 8)}...`;
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

/** Loads KEY=VALUE pairs from the repo-root .env without overriding existing env vars. */
function loadDotEnv(): void {
  const path = `${REPO_ROOT}.env`;
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    let value = (match[2] as string).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`missing env var ${name} (set it in .env, see .env.example)`);
  return value;
}

/** Builds PayPal's structured error fields; never the full payload (SPEC 0.2 rule 6). */
async function describeError(res: Response, context: string): Promise<string> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = asRecord(await res.json());
    const name = asString(body?.name);
    const message = asString(body?.message);
    const debugId = asString(body?.debug_id);
    if (name) detail += ` ${name}`;
    if (message) detail += `: ${message}`;
    if (debugId) detail += ` (debug_id ${debugId})`;
  } catch {
    // body was not JSON; the status line is all we print
  }
  return `${context} failed - ${detail}`;
}

async function failOnResponse(res: Response, context: string): Promise<never> {
  return fail(await describeError(res, context));
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

function readTokenCache(): TokenCache | undefined {
  try {
    const cached = asRecord(JSON.parse(readFileSync(TOKEN_CACHE_PATH, "utf8")));
    const accessToken = asString(cached?.accessToken);
    const expiresAt = typeof cached?.expiresAt === "number" ? cached.expiresAt : undefined;
    if (!accessToken || !expiresAt) return undefined;
    if (Date.now() + TOKEN_EXPIRY_MARGIN_MS >= expiresAt) return undefined;
    return { accessToken, expiresAt };
  } catch {
    return undefined;
  }
}

/** Fetches a client-credentials token; reuses the cached one while it is fresh (SPEC 7.1). */
async function getAccessToken(): Promise<{ token: string; expiresAt: number; cached: boolean }> {
  const cachedToken = readTokenCache();
  if (cachedToken) {
    return { token: cachedToken.accessToken, expiresAt: cachedToken.expiresAt, cached: true };
  }
  const clientId = requireEnv("PAYPAL_CLIENT_ID");
  const clientSecret = requireEnv("PAYPAL_CLIENT_SECRET");
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) await failOnResponse(res, "POST /v1/oauth2/token");
  const body = asRecord(await res.json());
  const accessToken = body?.access_token;
  const expiresIn = typeof body?.expires_in === "number" ? body.expires_in : undefined;
  if (typeof accessToken !== "string" || !expiresIn) {
    fail("token response missing access_token/expires_in");
  }
  const expiresAt = Date.now() + expiresIn * 1000;
  writeFileSync(
    TOKEN_CACHE_PATH,
    JSON.stringify({ accessToken, expiresAt } satisfies TokenCache),
    { mode: 0o600 },
  );
  return { token: accessToken, expiresAt, cached: false };
}

function authHeaders(token: string, requestId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "PayPal-Request-Id": requestId,
  };
}

async function cmdToken(): Promise<void> {
  const { token, expiresAt, cached } = await getAccessToken();
  console.log(`access_token: ${mask(token)} (${cached ? "from cache" : "freshly issued"})`);
  console.log(`expires_at: ${new Date(expiresAt).toISOString()} (cached in .paypal-token.json)`);
  console.log("TOKEN RESULT: OK");
}

async function cmdOrder(): Promise<void> {
  const { token } = await getAccessToken();
  const requestId = `smoke-top-${Date.now()}`;
  const createRes = await fetch(`${BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: authHeaders(token, requestId),
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: "5.00" } }],
    }),
  });
  if (!createRes.ok) await failOnResponse(createRes, "POST /v2/checkout/orders");
  const order = asRecord(await createRes.json());
  const orderId = asString(order?.id);
  const approveLink = asArray(order?.links)
    .map(asRecord)
    .find((link) => link?.rel === "approve");
  const approveUrl = asString(approveLink?.href);
  if (!orderId || !approveUrl) fail("order response missing id or approve link");

  console.log(`order created: ${orderId} (PayPal-Request-Id ${requestId})`);
  console.log(`\nOpen this URL in a browser:\n  ${approveUrl}`);
  console.log(
    "Log in as the sandbox PERSONAL (buyer) account, approve the payment, " +
      "then paste the full redirect URL you land on here.",
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pasted = (await rl.question("redirect URL: ")).trim();
  rl.close();
  let approvedOrderId: string | undefined;
  try {
    approvedOrderId = new URL(pasted).searchParams.get("token") ?? undefined;
  } catch {
    approvedOrderId = undefined;
  }
  approvedOrderId ??= /^[A-Z0-9]+$/i.test(pasted) ? pasted : undefined;
  if (!approvedOrderId) fail("could not parse an order id (token param) from the pasted URL");
  if (approvedOrderId !== orderId) {
    console.warn(`warning: pasted token ${approvedOrderId} differs from created order ${orderId}`);
  }

  const captureRes = await fetch(
    `${BASE_URL}/v2/checkout/orders/${approvedOrderId}/capture`,
    { method: "POST", headers: authHeaders(token, requestId) },
  );
  if (!captureRes.ok) await failOnResponse(captureRes, "POST capture");
  const capture = asRecord(await captureRes.json());
  const unit = asRecord(asArray(capture?.purchase_units)[0]);
  const payments = asRecord(unit?.payments);
  const cap = asRecord(asArray(payments?.captures)[0]);
  if (!cap) fail("capture response has no purchase_units[0].payments.captures[0]");
  const breakdown = asRecord(cap.seller_receivable_breakdown);
  const fee = asRecord(breakdown?.paypal_fee);
  const net = asRecord(breakdown?.net_amount);

  console.log(`capture status: ${asString(cap.status) ?? "unknown"}`);
  console.log(`capture id: ${asString(cap.id) ?? "unknown"}`);
  console.log(`paypal_fee: ${asString(fee?.value) ?? "?"} ${asString(fee?.currency_code) ?? ""}`);
  console.log(`net_amount: ${asString(net?.value) ?? "?"} ${asString(net?.currency_code) ?? ""}`);
  if (asString(cap.status) === "COMPLETED") {
    console.log("ORDER RESULT: OK - capture COMPLETED with fee and net reported by PayPal");
  } else {
    console.log("ORDER RESULT: capture not COMPLETED (PENDING waits for the webhook, spec 7.1)");
    process.exit(1);
  }
}

async function cmdPayout(): Promise<void> {
  const receiver = requireEnv("PAYPAL_SANDBOX_PAYER_ID");
  const { token } = await getAccessToken();
  const senderBatchId = `smoke-hgb-${Date.now()}`;
  const res = await fetch(`${BASE_URL}/v1/payments/payouts`, {
    method: "POST",
    headers: authHeaders(token, senderBatchId),
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        recipient_type: "PAYPAL_ID",
        email_subject: "Haggles sandbox smoke test payout",
      },
      items: [
        {
          recipient_type: "PAYPAL_ID",
          receiver,
          amount: { value: "0.01", currency: "USD" },
          sender_item_id: `smoke-pot-${Date.now()}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    // Submission failure is exactly what U1 exists to detect; still print the verdict line.
    console.error(`ERROR: ${await describeError(res, "POST /v1/payments/payouts")}`);
    console.log("U1 RESULT: payouts FAILED - use simulated payout mode (spec 2.4)");
    process.exit(1);
  }
  const created = asRecord(await res.json());
  const batchId = asString(asRecord(created?.batch_header)?.payout_batch_id);
  if (!batchId) fail("payout response missing batch_header.payout_batch_id");
  console.log(`payout batch submitted: ${batchId} (sender_batch_id ${senderBatchId})`);
  console.log("polling batch status every 5s for up to 3 minutes...");

  const deadline = Date.now() + PAYOUT_POLL_TIMEOUT_MS;
  let finalStatus = "UNKNOWN";
  let feePrinted = false;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, PAYOUT_POLL_INTERVAL_MS));
    const poll = await fetch(`${BASE_URL}/v1/payments/payouts/${batchId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!poll.ok) await failOnResponse(poll, "GET payout batch");
    const batch = asRecord(await poll.json());
    const status = asString(asRecord(batch?.batch_header)?.batch_status) ?? "UNKNOWN";
    finalStatus = status;
    const item = asRecord(asArray(batch?.items)[0]);
    const itemStatus = asString(item?.transaction_status);
    const fee = asRecord(item?.payout_item_fee);
    console.log(`  batch_status=${status} item_status=${itemStatus ?? "?"}`);
    if (!feePrinted && fee) {
      console.log(`  payout item fee: ${asString(fee.value) ?? "?"} ${asString(fee.currency_code) ?? ""}`);
      feePrinted = true;
    }
    if (status !== "PENDING" && status !== "PROCESSING") break;
  }

  console.log(`final batch_status: ${finalStatus}`);
  if (finalStatus === "SUCCESS") {
    console.log("U1 RESULT: payouts WORK on this sandbox account");
    process.exit(0);
  }
  console.log("U1 RESULT: payouts FAILED - use simulated payout mode (spec 2.4)");
  process.exit(1);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function cmdVerifyWebhook(filePath: string | undefined): Promise<void> {
  const webhookId = requireEnv("PAYPAL_WEBHOOK_ID");
  const raw = filePath ? readFileSync(filePath, "utf8") : await readStdin();
  const input = asRecord(JSON.parse(raw));
  if (!input) fail("input must be a JSON object {\"headers\": {...}, \"body\": {...}}");
  const headers = asRecord(input.headers);
  if (!headers) fail("input missing \"headers\" object");
  // Header names arrive in arbitrary case depending on the receiver; normalize to lowercase.
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") lower[key.toLowerCase()] = value;
  }
  const pick = (name: string): string => {
    const value = lower[`paypal-${name}`];
    if (!value) fail(`input headers missing PAYPAL-${name.toUpperCase()}`);
    return value;
  };
  const body = asRecord(input.body);
  if (!body) fail("input missing \"body\" object (the webhook event)");

  const { token } = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: authHeaders(token, `smoke-wh-${Date.now()}`),
    body: JSON.stringify({
      auth_algo: pick("auth-algo"),
      cert_url: pick("cert-url"),
      transmission_id: pick("transmission-id"),
      transmission_sig: pick("transmission-sig"),
      transmission_time: pick("transmission-time"),
      webhook_id: webhookId,
      webhook_event: body,
    }),
  });
  if (!res.ok) await failOnResponse(res, "POST verify-webhook-signature");
  const result = asRecord(await res.json());
  const status = asString(result?.verification_status) ?? "UNKNOWN";
  console.log(`verification_status: ${status}`);
  if (status === "SUCCESS") {
    console.log("WEBHOOK RESULT: OK - signature verifies against webhook ID from env");
    process.exit(0);
  }
  console.log("WEBHOOK RESULT: FAILED - do not trust events until this returns SUCCESS (spec 8.5)");
  process.exit(1);
}

async function main(): Promise<void> {
  loadDotEnv();
  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case "token":
      await cmdToken();
      break;
    case "order":
      await cmdOrder();
      break;
    case "payout":
      await cmdPayout();
      break;
    case "verify-webhook":
      await cmdVerifyWebhook(arg);
      break;
    default:
      console.error(
        "usage: bun scripts/paypal-smoke.ts <token|order|payout|verify-webhook> [event.json]",
      );
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
