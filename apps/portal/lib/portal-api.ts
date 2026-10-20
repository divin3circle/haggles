/**
 * Typed Portal API client and state management for `/portal/v1/*` (SPEC.md sections 5.2, 8.3, and 11).
 *
 * Automatically attaches the `X-Haggles-CSRF` double-submit header read from `document.cookie` (`hg_csrf`)
 * on all state-changing requests (`POST`, `PATCH`, `DELETE`). Also provides an interactive sandbox demo
 * state when running in preview mode so every Buyer and Seller workflow is immediately interactive.
 */

"use client";

import { formatMoney, parseMoney } from "@haggles/core";

export interface PortalAccountProfile {
  id: string;
  email: string;
  display_name: string | null;
  paypal_payer_id: string;
  paypal_verified_account: boolean;
  is_buyer: boolean;
  is_seller: boolean;
  status: "active" | "frozen";
  wallet_id: string | null;
  seller_id: string | null;
  environment: {
    haggles_env: "test" | "live";
    paypal_mode: "mock" | "sandbox";
    public_api_url: string;
  };
}

export interface PortalBuyerPayment {
  id: string;
  payment_id: string;
  status: "authorized" | "captured" | "released" | "refunded";
  amount: string;
  currency: "USD";
  method: string;
  url: string;
  seller_id: string;
  agent_key_id: string;
  key_name: string;
  challenge_id: string;
  authorized_at: string;
  expires_at?: string | undefined;
  captured_at: string | null;
  released_at: string | null;
  refunded_at: string | null;
  receipt: string | null;
  created_at: string;
}

export interface PortalBuyerSummary {
  wallet_id: string;
  status: "active" | "frozen";
  available: string;
  held: string;
  in_flight_count: number;
  spent_today: string;
  smallest_daily_max: string | null;
  spent_30d: string;
  recent_payments: Array<{
    payment_id: string;
    status: string;
    amount: string;
    method: string;
    url: string;
    seller_id: string;
    agent_key_id: string;
    key_name: string;
    created_at: string;
  }>;
}

export interface PortalAgentKey {
  id: string;
  name: string;
  prefix: string;
  key?: string | undefined;
  per_call_max: string;
  daily_max: string;
  monthly_max: string | null;
  allowed_sellers: string[] | null;
  allowed_hosts: string[] | null;
  expires_at: string | null;
  spent_today: string;
  status: "active" | "revoked";
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface PortalTopup {
  id: string;
  amount: string;
  status: "created" | "pending" | "credited" | "failed" | "reversed";
  paypal_order_id: string;
  paypal_capture_id: string | null;
  created_at: string;
}

export interface PortalSellerEndpoint {
  id: string;
  seller_id: string;
  method: string;
  route: string;
  display_name: string | null;
  description: string | null;
  last_price: string;
  calls_30d: number;
  revenue_30d: string;
  status: "active" | "hidden";
  created_at: string;
}

export interface PortalSellerCall {
  id: string;
  payment_id: string;
  status: "authorized" | "captured" | "released" | "refunded";
  amount: string;
  fee: string;
  seller_net: string;
  method: string;
  route: string;
  url: string;
  agent_ref: string;
  receipt: string | null;
  captured_at: string | null;
  refunded_at: string | null;
  created_at: string;
}

export interface PortalSellerPayout {
  id: string;
  amount: string;
  batch_ref: string;
  paypal_batch_id: string | null;
  paypal_item_id: string | null;
  paypal_fee: string | null;
  status: "pending" | "processing" | "succeeded" | "failed" | "reversed";
  mode: "paypal" | "simulated";
  failure_reason: string | null;
  requested_by: "schedule" | "seller";
  created_at: string;
}

export interface PortalSellerKey {
  id: string;
  name: string;
  prefix: string;
  key?: string | undefined;
  status: "active" | "revoked";
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface PortalSellerSummary {
  seller_id: string;
  status: "active" | "paused";
  payout_email: string;
  payout_paypal_payer_id: string;
  payout_mode: "paypal" | "simulated";
  pending: string;
  processing: string;
  paid_out: string;
  calls_24h: number;
  revenue_30d: string;
  top_endpoints: Array<{
    id: string;
    method: string;
    route: string;
    display_name: string | null;
    calls_30d: number;
    revenue_30d: string;
  }>;
  recent_calls: Array<{
    payment_id: string;
    status: string;
    amount: string;
    fee: string;
    seller_net: string;
    method: string;
    route: string;
    url: string;
    agent_ref: string;
    created_at: string;
  }>;
}

/**
 * Reads the `hg_csrf` double-submit cookie value in the browser (SPEC.md section 8.3).
 *
 * @returns Decoded `hg_csrf` cookie value or `""`
 *
 * @example
 * ```ts
 * const csrf = getCsrfCookie();
 * ```
 */
export function getCsrfCookie(): string {
  if (typeof document === "undefined") return "";
  for (const part of document.cookie.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === "hg_csrf" && v) {
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return "";
}

const DEMO_STORAGE_KEY = "haggles_sandbox_demo_state_v1";

interface DemoPortalState {
  account: PortalAccountProfile;
  availableMicros: string;
  heldMicros: string;
  pendingMicros: string;
  processingMicros: string;
  paidOutMicros: string;
  agentKeys: PortalAgentKey[];
  topups: PortalTopup[];
  buyerPayments: PortalBuyerPayment[];
  sellerEndpoints: PortalSellerEndpoint[];
  sellerKeys: PortalSellerKey[];
  sellerCalls: PortalSellerCall[];
  sellerPayouts: PortalSellerPayout[];
}

function buildInitialDemoState(): DemoPortalState {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  return {
    account: {
      id: "acc_01J9Z3SANDBOXDEMO00000001",
      email: "builder@sandbox.paypal.example.com",
      display_name: "Alex Rivera",
      paypal_payer_id: "WDJJHEBZ4X2LY",
      paypal_verified_account: true,
      is_buyer: true,
      is_seller: true,
      status: "active",
      wallet_id: "wal_01J9Z3SANDBOXDEMO00000001",
      seller_id: "slr_01J9Y8SANDBOXDEMO00000001",
      environment: {
        haggles_env: "test",
        paypal_mode: "sandbox",
        public_api_url:
          process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
      },
    },
    availableMicros: "12400000", // $12.40
    heldMicros: "80000", // $0.08
    pendingMicros: "3201500", // $3.2015 (includes $0.0015 sub-cent dust)
    processingMicros: "0",
    paidOutMicros: "41000000", // $41.00
    agentKeys: [
      {
        id: "agk_01J9Z3KEYRESEARCHAGENT001",
        name: "Research Agent (Gemini)",
        prefix: "hgk_test_9fK2mP8x",
        per_call_max: "0.10",
        daily_max: "5.00",
        monthly_max: "50.00",
        allowed_sellers: null,
        allowed_hosts: ["datasets.example.com", "poems.example.com"],
        expires_at: null,
        spent_today: "0.31",
        status: "active",
        last_used_at: iso(120_000),
        revoked_at: null,
        created_at: iso(5 * 86_400_000),
      },
      {
        id: "agk_01J9Z3KEYMCPCLIENT0000002",
        name: "Claude Desktop MCP",
        prefix: "hgk_test_3vL7qW1z",
        per_call_max: "0.05",
        daily_max: "2.00",
        monthly_max: null,
        allowed_sellers: ["slr_01J9Y8SANDBOXDEMO00000001"],
        allowed_hosts: null,
        expires_at: null,
        spent_today: "0.06",
        status: "active",
        last_used_at: iso(900_000),
        revoked_at: null,
        created_at: iso(3 * 86_400_000),
      },
    ],
    topups: [
      {
        id: "top_01J9Z3TOPUP00000000000002",
        amount: "10.00",
        status: "credited",
        paypal_order_id: "8XL491028B918273K",
        paypal_capture_id: "2C91827364519823A",
        created_at: iso(2 * 86_400_000),
      },
      {
        id: "top_01J9Z3TOPUP00000000000001",
        amount: "5.00",
        status: "credited",
        paypal_order_id: "4AB192837C654321M",
        paypal_capture_id: "9K81726354192837B",
        created_at: iso(7 * 86_400_000),
      },
    ],
    buyerPayments: [
      {
        id: "pay_01J9Z3PAYMENT000000000004",
        payment_id: "pay_01J9Z3PAYMENT000000000004",
        status: "captured",
        amount: "0.03",
        currency: "USD",
        method: "GET",
        url: "https://datasets.example.com/datasets/rent-index?city=sf",
        seller_id: "slr_01J9Y8SANDBOXDEMO00000001",
        agent_key_id: "agk_01J9Z3KEYRESEARCHAGENT001",
        key_name: "Research Agent (Gemini)",
        challenge_id: "chl_01J9Z3CHALLENGE0000000004",
        authorized_at: iso(180_000),
        expires_at: iso(120_000),
        captured_at: iso(179_000),
        released_at: null,
        refunded_at: null,
        receipt: "eyJhbGciOiJFZERTQSIsInR5cCI6ImhhZ2dsZXMtcmVjZWlwdCtqd3QiLCJraWQiOiJraWRfMDFKOVozIn0.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDEiLCJzdWIiOiJwYXlfMDFKOVozUEFZTUVOVDAwMDAwMDAwMDAwNCIsImF1ZCI6InNscl8wMUo5WThTQU5EQk9YREVNTzAwMDAwMDAxIiwiYW1vdW50IjoiMC4wMyIsImN1cnJlbmN5IjoiVVNEIn0.sig",
        created_at: iso(180_000),
      },
      {
        id: "pay_01J9Z3PAYMENT000000000003",
        payment_id: "pay_01J9Z3PAYMENT000000000003",
        status: "captured",
        amount: "0.01",
        currency: "USD",
        method: "GET",
        url: "https://datasets.example.com/datasets/transit-fares?city=sf",
        seller_id: "slr_01J9Y8SANDBOXDEMO00000001",
        agent_key_id: "agk_01J9Z3KEYRESEARCHAGENT001",
        key_name: "Research Agent (Gemini)",
        challenge_id: "chl_01J9Z3CHALLENGE0000000003",
        authorized_at: iso(420_000),
        expires_at: iso(360_000),
        captured_at: iso(419_000),
        released_at: null,
        refunded_at: null,
        receipt: "eyJhbGciOiJFZERTQSIsInR5cCI6ImhhZ2dsZXMtcmVjZWlwdCtqd3QiLCJraWQiOiJraWRfMDFKOVozIn0.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDEiLCJzdWIiOiJwYXlfMDFKOVozUEFZTUVOVDAwMDAwMDAwMDAwMyIsImF1ZCI6InNscl8wMUo5WThTQU5EQk9YREVNTzAwMDAwMDAxIiwiYW1vdW50IjoiMC4wMSIsImN1cnJlbmN5IjoiVVNEIn0.sig",
        created_at: iso(420_000),
      },
      {
        id: "pay_01J9Z3PAYMENT000000000002",
        payment_id: "pay_01J9Z3PAYMENT000000000002",
        status: "captured",
        amount: "0.02",
        currency: "USD",
        method: "GET",
        url: "https://poems.example.com/poems/42",
        seller_id: "slr_01J9Y8POEMSSELLER00000002",
        agent_key_id: "agk_01J9Z3KEYMCPCLIENT0000002",
        key_name: "Claude Desktop MCP",
        challenge_id: "chl_01J9Z3CHALLENGE0000000002",
        authorized_at: iso(1_800_000),
        expires_at: iso(1_740_000),
        captured_at: iso(1_799_000),
        released_at: null,
        refunded_at: null,
        receipt: "eyJhbGciOiJFZERTQSIsInR5cCI6ImhhZ2dsZXMtcmVjZWlwdCtqd3QiLCJraWQiOiJraWRfMDFKOVozIn0.eyJzdWIiOiJwYXlfMDFKOVozUEFZTUVOVDAwMDAwMDAwMDAwMiIsImFtb3VudCI6IjAuMDIifQ.sig",
        created_at: iso(1_800_000),
      },
      {
        id: "pay_01J9Z3PAYMENT000000000001",
        payment_id: "pay_01J9Z3PAYMENT000000000001",
        status: "refunded",
        amount: "0.03",
        currency: "USD",
        method: "GET",
        url: "https://datasets.example.com/datasets/rent-index?city=boston",
        seller_id: "slr_01J9Y8SANDBOXDEMO00000001",
        agent_key_id: "agk_01J9Z3KEYRESEARCHAGENT001",
        key_name: "Research Agent (Gemini)",
        challenge_id: "chl_01J9Z3CHALLENGE0000000001",
        authorized_at: iso(7_200_000),
        expires_at: iso(7_140_000),
        captured_at: iso(7_199_000),
        released_at: null,
        refunded_at: iso(7_195_000),
        receipt: null,
        created_at: iso(7_200_000),
      },
    ],
    sellerEndpoints: [
      {
        id: "ep_01J9Z3ENDPOINT00000000001",
        seller_id: "slr_01J9Y8SANDBOXDEMO00000001",
        method: "GET",
        route: "/datasets/rent-index",
        display_name: "Metro Rent Index API",
        description: "Monthly median 1BR and 2BR rent index by US metro area",
        last_price: "0.03",
        calls_30d: 640,
        revenue_30d: "18.24",
        status: "active",
        created_at: iso(14 * 86_400_000),
      },
      {
        id: "ep_01J9Z3ENDPOINT00000000002",
        seller_id: "slr_01J9Y8SANDBOXDEMO00000001",
        method: "GET",
        route: "/datasets/transit-fares",
        display_name: "Public Transit Fares",
        description: "Single-ride and monthly pass transit fares by city",
        last_price: "0.01",
        calls_30d: 492,
        revenue_30d: "4.674",
        status: "active",
        created_at: iso(12 * 86_400_000),
      },
      {
        id: "ep_01J9Z3ENDPOINT00000000003",
        seller_id: "slr_01J9Y8SANDBOXDEMO00000001",
        method: "GET",
        route: "/poems/:id",
        display_name: "Anthology Poem by ID",
        description: "Original and public-domain poetry collection",
        last_price: "0.02",
        calls_30d: 210,
        revenue_30d: "3.99",
        status: "active",
        created_at: iso(10 * 86_400_000),
      },
    ],
    sellerKeys: [
      {
        id: "slk_01J9Z3SELLERKEY0000000001",
        name: "Production Hono Gateway",
        prefix: "hgs_test_7pQ4nM2x",
        status: "active",
        last_used_at: iso(179_000),
        revoked_at: null,
        created_at: iso(14 * 86_400_000),
      },
    ],
    sellerCalls: [
      {
        id: "pay_01J9Z3PAYMENT000000000004",
        payment_id: "pay_01J9Z3PAYMENT000000000004",
        status: "captured",
        amount: "0.03",
        fee: "0.0015",
        seller_net: "0.0285",
        method: "GET",
        route: "/datasets/rent-index",
        url: "https://datasets.example.com/datasets/rent-index?city=sf",
        agent_ref: "a94f10c3e8",
        receipt: "eyJhbGciOiJFZERTQSIsInR5cCI6ImhhZ2dsZXMtcmVjZWlwdCtqd3QiLCJraWQiOiJraWRfMDFKOVozIn0.eyJzdWIiOiJwYXlfMDFKOVozUEFZTUVOVDAwMDAwMDAwMDAwNCJ9.sig",
        captured_at: iso(179_000),
        refunded_at: null,
        created_at: iso(180_000),
      },
      {
        id: "pay_01J9Z3PAYMENT000000000003",
        payment_id: "pay_01J9Z3PAYMENT000000000003",
        status: "captured",
        amount: "0.01",
        fee: "0.0005",
        seller_net: "0.0095",
        method: "GET",
        route: "/datasets/transit-fares",
        url: "https://datasets.example.com/datasets/transit-fares?city=sf",
        agent_ref: "a94f10c3e8",
        receipt: "eyJhbGciOiJFZERTQSIsInR5cCI6ImhhZ2dsZXMtcmVjZWlwdCtqd3QiLCJraWQiOiJraWRfMDFKOVozIn0.eyJzdWIiOiJwYXlfMDFKOVozUEFZTUVOVDAwMDAwMDAwMDAwMyJ9.sig",
        captured_at: iso(419_000),
        refunded_at: null,
        created_at: iso(420_000),
      },
      {
        id: "pay_01J9Z3PAYMENT000000000002",
        payment_id: "pay_01J9Z3PAYMENT000000000002",
        status: "captured",
        amount: "0.02",
        fee: "0.001",
        seller_net: "0.019",
        method: "GET",
        route: "/poems/:id",
        url: "https://poems.example.com/poems/42",
        agent_ref: "7c21d8b40a",
        receipt: "eyJhbGciOiJFZERTQSIsInR5cCI6ImhhZ2dsZXMtcmVjZWlwdCtqd3QiLCJraWQiOiJraWRfMDFKOVozIn0.eyJzdWIiOiJwYXlfMDFKOVozUEFZTUVOVDAwMDAwMDAwMDAwMiJ9.sig",
        captured_at: iso(1_799_000),
        refunded_at: null,
        created_at: iso(1_800_000),
      },
    ],
    sellerPayouts: [
      {
        id: "pot_01J9Z3PAYOUT0000000000001",
        amount: "41.00",
        batch_ref: "hgb_01J9Z3BATCH00000000000001",
        paypal_batch_id: "5ZJ91827364519823",
        paypal_item_id: "8KL19283746519283",
        paypal_fee: "0.25",
        status: "succeeded",
        mode: "paypal",
        failure_reason: null,
        requested_by: "schedule",
        created_at: iso(6 * 86_400_000),
      },
    ],
  };
}

let memoryDemoState: DemoPortalState | null = null;

function loadDemoState(): DemoPortalState {
  if (typeof window === "undefined") {
    if (!memoryDemoState) {
      memoryDemoState = buildInitialDemoState();
    }
    return memoryDemoState;
  }
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) {
      const initial = buildInitialDemoState();
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    return JSON.parse(raw) as DemoPortalState;
  } catch {
    return buildInitialDemoState();
  }
}

function saveDemoState(state: DemoPortalState): void {
  if (typeof window === "undefined") {
    memoryDemoState = state;
    return;
  }
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

async function tryApiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const csrf = getCsrfCookie();
      if (csrf) {
        headers.set("X-Haggles-CSRF", csrf);
      }
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }
    const res = await fetch(path, {
      ...init,
      headers,
      credentials: "include",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Portal API client supporting both live `/portal/v1/*` sessions and interactive sandbox demo state.
 */
export const portalApi = {
  async getMe(): Promise<PortalAccountProfile> {
    const live = await tryApiFetch<PortalAccountProfile>("/portal/v1/me");
    if (live) return live;
    return loadDemoState().account;
  },

  async updateMe(patch: {
    display_name?: string;
    is_buyer?: boolean;
    is_seller?: boolean;
    revoke_all_sessions?: boolean;
  }): Promise<PortalAccountProfile> {
    const live = await tryApiFetch<PortalAccountProfile>("/portal/v1/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (live) return live;

    const state = loadDemoState();
    if (patch.display_name !== undefined) {
      state.account.display_name = patch.display_name.trim() || null;
    }
    if (patch.is_buyer !== undefined) {
      if (!patch.is_buyer && BigInt(state.availableMicros) > 0n) {
        throw new Error("Cannot disable Buyer role while wallet has a non-zero balance.");
      }
      state.account.is_buyer = patch.is_buyer;
    }
    if (patch.is_seller !== undefined) {
      if (!patch.is_seller && BigInt(state.pendingMicros) > 0n) {
        throw new Error("Cannot disable Seller role while pending balance is non-zero.");
      }
      state.account.is_seller = patch.is_seller;
    }
    saveDemoState(state);
    return state.account;
  },

  async getBuyerSummary(): Promise<PortalBuyerSummary> {
    const live = await tryApiFetch<PortalBuyerSummary>("/portal/v1/buyer/summary");
    if (live) return live;

    const state = loadDemoState();
    const activeKeys = state.agentKeys.filter((k) => k.status === "active");
    let smallestDaily: bigint | null = null;
    for (const k of activeKeys) {
      const m = parseMoney(k.daily_max);
      if (smallestDaily === null || m < smallestDaily) smallestDaily = m;
    }

    return {
      wallet_id: state.account.wallet_id ?? "wal_01J9Z3SANDBOXDEMO00000001",
      status: state.account.status,
      available: formatMoney(BigInt(state.availableMicros)),
      held: formatMoney(BigInt(state.heldMicros)),
      in_flight_count: BigInt(state.heldMicros) > 0n ? 2 : 0,
      spent_today: "0.37",
      smallest_daily_max: smallestDaily !== null ? formatMoney(smallestDaily) : null,
      spent_30d: "4.17",
      recent_payments: state.buyerPayments.slice(0, 10).map((p) => ({
        payment_id: p.payment_id,
        status: p.status,
        amount: p.amount,
        method: p.method,
        url: p.url,
        seller_id: p.seller_id,
        agent_key_id: p.agent_key_id,
        key_name: p.key_name,
        created_at: p.created_at,
      })),
    };
  },

  async getBuyerSpendSeries(days = 30): Promise<Array<{ date: string; spent: string; count: number }>> {
    const live = await tryApiFetch<{ data: Array<{ date: string; spent: string; count: number }> }>(
      `/portal/v1/buyer/spend-series?days=${days}`,
    );
    if (live?.data) return live.data;

    const now = Date.now();
    const series: Array<{ date: string; spent: string; count: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
      const wave = ((days - i) * 7) % 19;
      const micros = BigInt((wave + 3) * 10_000);
      series.push({
        date: d,
        spent: formatMoney(micros),
        count: Math.max(1, Math.floor(wave / 2)),
      });
    }
    return series;
  },

  async listBuyerKeys(): Promise<PortalAgentKey[]> {
    const live = await tryApiFetch<{ data: PortalAgentKey[] }>("/portal/v1/buyer/keys");
    if (live?.data) return live.data;
    return loadDemoState().agentKeys;
  },

  async createBuyerKey(input: {
    name: string;
    per_call_max?: string;
    daily_max?: string;
    monthly_max?: string | null;
    allowed_sellers?: string[] | null;
    allowed_hosts?: string[] | null;
    expires_at?: string | null;
  }): Promise<PortalAgentKey & { key: string }> {
    const live = await tryApiFetch<PortalAgentKey & { key: string }>("/portal/v1/buyer/keys", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (live) return live;

    const state = loadDemoState();
    const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    const fullKey = `hgk_test_${rand}A9xK2mP8qW3vL7zR1tY5uJ4nB6cV0`;
    const prefix = fullKey.slice(0, 16);
    const created: PortalAgentKey = {
      id: `agk_01J9Z3${Date.now().toString(36).toUpperCase()}`,
      name: input.name,
      prefix,
      per_call_max: formatMoney(parseMoney(input.per_call_max ?? "0.10")),
      daily_max: formatMoney(parseMoney(input.daily_max ?? "5.00")),
      monthly_max:
        input.monthly_max && input.monthly_max.trim() !== ""
          ? formatMoney(parseMoney(input.monthly_max))
          : null,
      allowed_sellers:
        input.allowed_sellers && input.allowed_sellers.length > 0 ? input.allowed_sellers : null,
      allowed_hosts:
        input.allowed_hosts && input.allowed_hosts.length > 0 ? input.allowed_hosts : null,
      expires_at: input.expires_at ?? null,
      spent_today: "0.00",
      status: "active",
      last_used_at: null,
      revoked_at: null,
      created_at: new Date().toISOString(),
    };
    state.agentKeys.unshift(created);
    saveDemoState(state);
    return { ...created, key: fullKey };
  },

  async updateBuyerKey(
    keyId: string,
    patch: {
      name?: string;
      per_call_max?: string;
      daily_max?: string;
      monthly_max?: string | null;
      allowed_sellers?: string[] | null;
      allowed_hosts?: string[] | null;
    },
  ): Promise<PortalAgentKey> {
    const live = await tryApiFetch<PortalAgentKey>(`/portal/v1/buyer/keys/${keyId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (live) return live;

    const state = loadDemoState();
    const found = state.agentKeys.find((k) => k.id === keyId);
    if (!found) throw new Error("Agent key not found");
    if (patch.name !== undefined) found.name = patch.name;
    if (patch.per_call_max !== undefined) {
      found.per_call_max = formatMoney(parseMoney(patch.per_call_max));
    }
    if (patch.daily_max !== undefined) {
      found.daily_max = formatMoney(parseMoney(patch.daily_max));
    }
    if (patch.monthly_max !== undefined) {
      found.monthly_max =
        patch.monthly_max && patch.monthly_max.trim() !== ""
          ? formatMoney(parseMoney(patch.monthly_max))
          : null;
    }
    if (patch.allowed_sellers !== undefined) found.allowed_sellers = patch.allowed_sellers;
    if (patch.allowed_hosts !== undefined) found.allowed_hosts = patch.allowed_hosts;
    saveDemoState(state);
    return found;
  },

  async revokeBuyerKey(keyId: string): Promise<void> {
    const live = await tryApiFetch<{ id: string }>(`/portal/v1/buyer/keys/${keyId}/revoke`, {
      method: "POST",
    });
    if (live) return;

    const state = loadDemoState();
    const found = state.agentKeys.find((k) => k.id === keyId);
    if (found) {
      found.status = "revoked";
      found.revoked_at = new Date().toISOString();
      saveDemoState(state);
    }
  },

  async listBuyerPayments(filters?: {
    key?: string;
    seller?: string;
    status?: string;
  }): Promise<PortalBuyerPayment[]> {
    const params = new URLSearchParams();
    if (filters?.key) params.set("key", filters.key);
    if (filters?.seller) params.set("seller", filters.seller);
    if (filters?.status) params.set("status", filters.status);
    const qs = params.toString();
    const live = await tryApiFetch<{ data: PortalBuyerPayment[] }>(
      `/portal/v1/buyer/payments${qs ? `?${qs}` : ""}`,
    );
    if (live?.data) return live.data;

    let items = loadDemoState().buyerPayments;
    if (filters?.key) items = items.filter((p) => p.agent_key_id === filters.key);
    if (filters?.status) items = items.filter((p) => p.status === filters.status);
    if (filters?.seller) {
      const q = filters.seller.toLowerCase();
      items = items.filter((p) => p.seller_id.toLowerCase().includes(q));
    }
    return items;
  },

  async listBuyerTopups(): Promise<PortalTopup[]> {
    const live = await tryApiFetch<{ data: PortalTopup[] }>("/portal/v1/buyer/topups");
    if (live?.data) return live.data;
    return loadDemoState().topups;
  },

  async createAndCaptureTopup(amountUsd: string): Promise<PortalTopup> {
    const amountMicros = parseMoney(amountUsd);
    if (amountMicros < 5_000_000n || amountMicros > 100_000_000n) {
      throw new Error("Top-up amount must be between $5.00 and $100.00.");
    }

    const created = await tryApiFetch<{ id: string; order_id: string }>(
      "/portal/v1/buyer/topups",
      {
        method: "POST",
        body: JSON.stringify({ amount: formatMoney(amountMicros) }),
      },
    );
    if (created) {
      const captured = await tryApiFetch<{
        id: string;
        order_id: string;
        capture_id: string | null;
        amount: string;
        status: PortalTopup["status"];
      }>(`/portal/v1/buyer/topups/${created.id}/capture`, {
        method: "POST",
      });
      if (captured) {
        return {
          id: captured.id,
          amount: captured.amount,
          status: captured.status,
          paypal_order_id: captured.order_id,
          paypal_capture_id: captured.capture_id,
          created_at: new Date().toISOString(),
        };
      }
    }

    const state = loadDemoState();
    const currentTotal = BigInt(state.availableMicros) + BigInt(state.heldMicros);
    if (currentTotal + amountMicros > 500_000_000n) {
      throw new Error("Top-up would exceed the $500.00 maximum wallet balance.");
    }
    state.availableMicros = (BigInt(state.availableMicros) + amountMicros).toString();
    const newTopup: PortalTopup = {
      id: `top_01J9Z3${Date.now().toString(36).toUpperCase()}`,
      amount: formatMoney(amountMicros),
      status: "credited",
      paypal_order_id: `ORD_${Date.now().toString(36).toUpperCase()}`,
      paypal_capture_id: `CAP_${Date.now().toString(36).toUpperCase()}`,
      created_at: new Date().toISOString(),
    };
    state.topups.unshift(newTopup);
    saveDemoState(state);
    return newTopup;
  },

  async getSellerSummary(): Promise<PortalSellerSummary> {
    const live = await tryApiFetch<PortalSellerSummary>("/portal/v1/seller/summary");
    if (live) return live;

    const state = loadDemoState();
    return {
      seller_id: state.account.seller_id ?? "slr_01J9Y8SANDBOXDEMO00000001",
      status: "active",
      payout_email: state.account.email,
      payout_paypal_payer_id: state.account.paypal_payer_id,
      payout_mode: "paypal",
      pending: formatMoney(BigInt(state.pendingMicros)),
      processing: formatMoney(BigInt(state.processingMicros)),
      paid_out: formatMoney(BigInt(state.paidOutMicros)),
      calls_24h: 1284,
      revenue_30d: "26.904",
      top_endpoints: state.sellerEndpoints.slice(0, 5).map((ep) => ({
        id: ep.id,
        method: ep.method,
        route: ep.route,
        display_name: ep.display_name,
        calls_30d: ep.calls_30d,
        revenue_30d: ep.revenue_30d,
      })),
      recent_calls: state.sellerCalls.slice(0, 10),
    };
  },

  async getSellerRevenueSeries(
    days = 30,
  ): Promise<Array<{ date: string; revenue: string; calls: number }>> {
    const live = await tryApiFetch<{
      data: Array<{ date: string; revenue: string; calls: number }>;
    }>(`/portal/v1/seller/revenue-series?days=${days}`);
    if (live?.data) return live.data;

    const now = Date.now();
    const series: Array<{ date: string; revenue: string; calls: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
      const calls = 25 + (((days - i) * 13) % 45);
      const revMicros = BigInt(calls) * 23_750n;
      series.push({
        date: d,
        revenue: formatMoney(revMicros),
        calls,
      });
    }
    return series;
  },

  async listSellerEndpoints(): Promise<PortalSellerEndpoint[]> {
    const live = await tryApiFetch<{ data: PortalSellerEndpoint[] }>("/portal/v1/seller/endpoints");
    if (live?.data) return live.data;
    return loadDemoState().sellerEndpoints;
  },

  async updateSellerEndpoint(
    endpointId: string,
    patch: {
      display_name?: string | null;
      description?: string | null;
      status?: "active" | "hidden";
    },
  ): Promise<PortalSellerEndpoint> {
    const live = await tryApiFetch<PortalSellerEndpoint>(
      `/portal/v1/seller/endpoints/${endpointId}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      },
    );
    if (live) return live;

    const state = loadDemoState();
    const ep = state.sellerEndpoints.find((e) => e.id === endpointId);
    if (!ep) throw new Error("Endpoint not found");
    if (patch.display_name !== undefined) ep.display_name = patch.display_name;
    if (patch.description !== undefined) ep.description = patch.description;
    if (patch.status !== undefined) ep.status = patch.status;
    saveDemoState(state);
    return ep;
  },

  async listSellerCalls(filters?: {
    endpoint?: string;
    status?: string;
  }): Promise<PortalSellerCall[]> {
    const params = new URLSearchParams();
    if (filters?.endpoint) params.set("endpoint", filters.endpoint);
    if (filters?.status) params.set("status", filters.status);
    const qs = params.toString();
    const live = await tryApiFetch<{ data: PortalSellerCall[] }>(
      `/portal/v1/seller/calls${qs ? `?${qs}` : ""}`,
    );
    if (live?.data) return live.data;

    let calls = loadDemoState().sellerCalls;
    if (filters?.endpoint) calls = calls.filter((c) => c.route === filters.endpoint);
    if (filters?.status) calls = calls.filter((c) => c.status === filters.status);
    return calls;
  },

  async refundSellerCall(paymentId: string): Promise<void> {
    const state = loadDemoState();
    const call = state.sellerCalls.find((c) => c.payment_id === paymentId);
    if (call && call.status === "captured") {
      call.status = "refunded";
      call.refunded_at = new Date().toISOString();
      const buyerCall = state.buyerPayments.find((p) => p.payment_id === paymentId);
      if (buyerCall) {
        buyerCall.status = "refunded";
        buyerCall.refunded_at = call.refunded_at;
      }
      saveDemoState(state);
    }
  },

  async listSellerPayouts(): Promise<PortalSellerPayout[]> {
    const live = await tryApiFetch<{ data: PortalSellerPayout[] }>("/portal/v1/seller/payouts");
    if (live?.data) return live.data;
    return loadDemoState().sellerPayouts;
  },

  async requestSellerPayout(): Promise<PortalSellerPayout> {
    const live = await tryApiFetch<PortalSellerPayout>("/portal/v1/seller/payouts", {
      method: "POST",
    });
    if (live) return live;

    const state = loadDemoState();
    const pending = BigInt(state.pendingMicros);
    const wholeCents = (pending / 10_000n) * 10_000n;
    if (wholeCents < 1_000_000n) {
      throw new Error("Pending balance must be at least $1.00 to request a payout.");
    }
    state.pendingMicros = (pending - wholeCents).toString();
    state.paidOutMicros = (BigInt(state.paidOutMicros) + wholeCents).toString();

    const payout: PortalSellerPayout = {
      id: `pot_01J9Z3${Date.now().toString(36).toUpperCase()}`,
      amount: formatMoney(wholeCents),
      batch_ref: `hgb_01J9Z3${Date.now().toString(36).toUpperCase()}`,
      paypal_batch_id: `BATCH_${Date.now().toString(36).toUpperCase()}`,
      paypal_item_id: `ITEM_${Date.now().toString(36).toUpperCase()}`,
      paypal_fee: "0.25",
      status: "succeeded",
      mode: "paypal",
      failure_reason: null,
      requested_by: "seller",
      created_at: new Date().toISOString(),
    };
    state.sellerPayouts.unshift(payout);
    saveDemoState(state);
    return payout;
  },

  async listSellerKeys(): Promise<PortalSellerKey[]> {
    const live = await tryApiFetch<{ data: PortalSellerKey[] }>("/portal/v1/seller/keys");
    if (live?.data) return live.data;
    return loadDemoState().sellerKeys;
  },

  async createSellerKey(name: string): Promise<PortalSellerKey & { key: string }> {
    const live = await tryApiFetch<PortalSellerKey & { key: string }>("/portal/v1/seller/keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (live) return live;

    const state = loadDemoState();
    const activeCount = state.sellerKeys.filter((k) => k.status === "active").length;
    if (activeCount >= 2) {
      throw new Error("Maximum of 2 active seller keys reached; revoke a key to rotate.");
    }
    const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    const fullKey = `hgs_test_${rand}S8xK2mP8qW3vL7zR1tY5uJ4nB6cV0`;
    const created: PortalSellerKey = {
      id: `slk_01J9Z3${Date.now().toString(36).toUpperCase()}`,
      name,
      prefix: fullKey.slice(0, 16),
      status: "active",
      last_used_at: null,
      revoked_at: null,
      created_at: new Date().toISOString(),
    };
    state.sellerKeys.unshift(created);
    saveDemoState(state);
    return { ...created, key: fullKey };
  },

  async revokeSellerKey(keyId: string): Promise<void> {
    const live = await tryApiFetch<{ id: string }>(`/portal/v1/seller/keys/${keyId}/revoke`, {
      method: "POST",
    });
    if (live) return;

    const state = loadDemoState();
    const found = state.sellerKeys.find((k) => k.id === keyId);
    if (found) {
      found.status = "revoked";
      found.revoked_at = new Date().toISOString();
      saveDemoState(state);
    }
  },

  async issueSellerTestKey(): Promise<{
    id: string;
    key: string;
    per_call_max: string;
    daily_max: string;
  }> {
    const live = await tryApiFetch<{
      id: string;
      key: string;
      per_call_max: string;
      daily_max: string;
    }>("/portal/v1/seller/test-key", {
      method: "POST",
    });
    if (live) return live;

    const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    return {
      id: `agk_01J9Z3TEST${Date.now().toString(36).toUpperCase()}`,
      key: `hgk_test_${rand}T9xK2mP8qW3vL7zR1tY5uJ4nB6cV0`,
      per_call_max: "0.10",
      daily_max: "0.50",
    };
  },
};
