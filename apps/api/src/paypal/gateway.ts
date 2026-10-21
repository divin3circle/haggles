/**
 * `PayPalGateway` interface, real sandbox implementation (`SandboxPayPalGateway`),
 * and deterministic in-memory mock (`MockPayPalGateway`).
 *
 * Implements SPEC.md sections 7.1, 7.2, 7.3, 8.3, 8.5, 14.2, and Appendix C.
 * Never logs secrets, tokens, or full PayPal payloads (SPEC.md section 0.2 rule 6).
 */

import { createId, formatMoney, parseMoney } from "@haggles/core";
import type { ApiConfig } from "../config.js";

const SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com";
const SANDBOX_AUTH_URL = "https://www.sandbox.paypal.com/signin/authorize";
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * Result of capturing or inspecting a PayPal Order capture (SPEC.md section 7.1).
 *
 * @example
 * ```ts
 * console.log(capture.status); // "COMPLETED"
 * ```
 */
export interface PayPalCaptureDetails {
  captureId: string;
  status: "COMPLETED" | "PENDING" | "DECLINED" | "FAILED";
  grossMicros: bigint;
  feeMicros: bigint;
  netMicros: bigint;
}

/**
 * Item status inside a PayPal Payouts batch (SPEC.md section 7.2 and Appendix C).
 *
 * @example
 * ```ts
 * console.log(item.transactionStatus); // "SUCCESS"
 * ```
 */
export interface PayPalPayoutItemDetails {
  payoutItemId: string;
  senderItemId: string;
  transactionStatus:
    | "SUCCESS"
    | "PENDING"
    | "PROCESSING"
    | "FAILED"
    | "DENIED"
    | "BLOCKED"
    | "CANCELED"
    | "HELD"
    | "UNCLAIMED"
    | "RETURNED"
    | "REFUNDED";
  amountMicros: bigint;
  feeMicros: bigint | null;
  failureReason?: string | undefined;
}

/**
 * Identity returned by Log in with PayPal userinfo (`schema=paypalv1.1`, SPEC.md section 8.3 and Appendix C).
 *
 * @example
 * ```ts
 * console.log(identity.paypalPayerId); // "PAYER_ID_123"
 * ```
 */
export interface PayPalUserIdentity {
  paypalUserId: string;
  paypalPayerId: string;
  email: string;
  displayName: string | null;
  verifiedAccount: boolean;
}

/**
 * Gateway abstraction for all outbound PayPal calls (Orders v2, Payouts v1, OIDC userinfo, Webhook verification).
 *
 * @example
 * ```ts
 * const order = await gateway.createOrder({ topupId: "top_01J...", amountMicros: 5_000_000n });
 * ```
 */
export interface PayPalGateway {
  readonly mode: "mock" | "sandbox";

  /**
   * Creates a PayPal Order with `intent: "CAPTURE"` and `PayPal-Request-Id = topupId` (SPEC.md section 7.1 step 1).
   */
  createOrder(params: {
    topupId: string;
    amountMicros: bigint;
  }): Promise<{ orderId: string; approveUrl: string }>;

  /**
   * Captures an approved PayPal Order (`POST /v2/checkout/orders/{id}/capture`, SPEC.md section 7.1 step 3).
   */
  captureOrder(params: {
    topupId: string;
    orderId: string;
  }): Promise<PayPalCaptureDetails>;

  /**
   * Fetches an existing PayPal Order to verify capture amounts/status before crediting the ledger (SPEC.md sections 7.1 and 8.5).
   */
  getOrder(orderId: string): Promise<{
    orderId: string;
    orderStatus: string;
    customId?: string | undefined;
    capture?: PayPalCaptureDetails | undefined;
  }>;

  /**
   * Submits a PayPal Payouts batch (`POST /v1/payments/payouts`, SPEC.md section 7.2 step 4).
   * Handles duplicate `sender_batch_id` crash recovery by adopting the original `payout_batch_id`.
   */
  createPayoutBatch(params: {
    batchRef: string;
    items: ReadonlyArray<{
      payoutId: string;
      receiverPayerId: string;
      amountMicros: bigint;
    }>;
  }): Promise<{ paypalBatchId: string }>;

  /**
   * Fetches payout batch and item details (`GET /v1/payments/payouts/{batch_id}`, SPEC.md section 7.2 step 5).
   */
  getPayoutBatch(paypalBatchId: string): Promise<{
    paypalBatchId: string;
    batchStatus: string;
    items: PayPalPayoutItemDetails[];
  }>;

  /**
   * Builds the Log in with PayPal authorization URL (no PKCE, confidential client, SPEC.md section 8.3).
   */
  buildAuthorizeUrl(params: { state: string; redirectUri: string }): string;

  /**
   * Exchanges an OAuth2 authorization code and fetches `/v1/identity/oauth2/userinfo?schema=paypalv1.1` (SPEC.md section 8.3).
   */
  exchangeCodeForUserInfo(params: {
    code: string;
    redirectUri: string;
  }): Promise<PayPalUserIdentity>;

  /**
   * Verifies a PayPal webhook delivery via `POST /v1/notifications/verify-webhook-signature` (SPEC.md section 8.5).
   */
  verifyWebhookSignature(params: {
    headers: Record<string, string | undefined>;
    rawBody: string;
  }): Promise<boolean>;
}

/**
 * Deterministic in-memory `PayPalGateway` used when `PAYPAL_MODE=mock` (local dev and CI, SPEC.md section 14.2).
 *
 * Supports configuring failure modes (`PENDING`, `DECLINED`, `FAILED`, payout item failures, bad webhook signatures)
 * for comprehensive integration testing.
 *
 * @example
 * ```ts
 * const mock = new MockPayPalGateway();
 * ```
 */
export class MockPayPalGateway implements PayPalGateway {
  readonly mode = "mock" as const;

  private readonly orders = new Map<
    string,
    {
      orderId: string;
      topupId: string;
      amountMicros: bigint;
      orderStatus: string;
      nextCaptureStatus: "COMPLETED" | "PENDING" | "DECLINED" | "FAILED";
      capture?: PayPalCaptureDetails | undefined;
    }
  >();
  private readonly orderByTopupId = new Map<string, string>();

  private readonly payoutBatches = new Map<
    string,
    {
      paypalBatchId: string;
      batchRef: string;
      batchStatus: string;
      items: PayPalPayoutItemDetails[];
    }
  >();
  private readonly batchIdByRef = new Map<string, string>();

  private readonly mockUsersByCode = new Map<string, PayPalUserIdentity>();
  private nextCaptureStatusOverride: "COMPLETED" | "PENDING" | "DECLINED" | "FAILED" = "COMPLETED";
  private nextPayoutItemStatusOverride: PayPalPayoutItemDetails["transactionStatus"] = "SUCCESS";

  /**
   * Registers a mock user identity to return when `exchangeCodeForUserInfo` is called with `code`.
   */
  registerMockAuthCode(code: string, identity: PayPalUserIdentity): void {
    this.mockUsersByCode.set(code, identity);
  }

  /**
   * Configures the capture status returned by subsequent `captureOrder` calls in tests.
   */
  setNextCaptureStatus(status: "COMPLETED" | "PENDING" | "DECLINED" | "FAILED"): void {
    this.nextCaptureStatusOverride = status;
  }

  /**
   * Transitions an existing mock order's capture status (e.g. from `PENDING` to `COMPLETED` before delivering a webhook).
   */
  setOrderCaptureStatus(
    orderId: string,
    status: "COMPLETED" | "PENDING" | "DECLINED" | "FAILED",
  ): PayPalCaptureDetails {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Mock order ${orderId} not found`);
    }
    const feeMicros = (order.amountMicros * 349n) / 10_000n + 490_000n <= order.amountMicros
      ? (order.amountMicros * 300n) / 10_000n
      : 0n;
    const capture: PayPalCaptureDetails = {
      captureId: order.capture?.captureId ?? `CAP_${orderId}`,
      status,
      grossMicros: order.amountMicros,
      feeMicros,
      netMicros: order.amountMicros - feeMicros,
    };
    order.capture = capture;
    order.orderStatus = status === "COMPLETED" ? "COMPLETED" : "APPROVED";
    return capture;
  }

  /**
   * Configures the initial item status for subsequent `createPayoutBatch` calls in tests.
   */
  setNextPayoutItemStatus(status: PayPalPayoutItemDetails["transactionStatus"]): void {
    this.nextPayoutItemStatusOverride = status;
  }

  /**
   * Updates the status of a payout item in a mock batch (e.g. simulating webhook progression).
   */
  setPayoutItemStatus(
    paypalBatchId: string,
    senderItemId: string,
    status: PayPalPayoutItemDetails["transactionStatus"],
    feeMicros: bigint | null = 250_000n,
    failureReason?: string,
  ): void {
    const batch = this.payoutBatches.get(paypalBatchId);
    if (!batch) {
      throw new Error(`Mock payout batch ${paypalBatchId} not found`);
    }
    const item = batch.items.find((i) => i.senderItemId === senderItemId);
    if (!item) {
      throw new Error(`Mock payout item ${senderItemId} not found in batch ${paypalBatchId}`);
    }
    item.transactionStatus = status;
    item.feeMicros = feeMicros;
    item.failureReason = failureReason;
    batch.batchStatus = status === "SUCCESS" ? "SUCCESS" : status === "DENIED" ? "DENIED" : "PROCESSING";
  }

  async createOrder(params: {
    topupId: string;
    amountMicros: bigint;
  }): Promise<{ orderId: string; approveUrl: string }> {
    const existingOrderId = this.orderByTopupId.get(params.topupId);
    if (existingOrderId) {
      return {
        orderId: existingOrderId,
        approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${existingOrderId}`,
      };
    }
    const orderId = `ORD_${createId("top").slice(4)}`;
    this.orders.set(orderId, {
      orderId,
      topupId: params.topupId,
      amountMicros: params.amountMicros,
      orderStatus: "CREATED",
      nextCaptureStatus: this.nextCaptureStatusOverride,
    });
    this.orderByTopupId.set(params.topupId, orderId);
    return {
      orderId,
      approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
    };
  }

  async captureOrder(params: {
    topupId: string;
    orderId: string;
  }): Promise<PayPalCaptureDetails> {
    const order = this.orders.get(params.orderId);
    if (!order) {
      throw new Error(`PayPal order ${params.orderId} not found`);
    }
    if (order.capture) {
      return order.capture;
    }
    // 3% simulated PayPal fee on mock captures
    const feeMicros = (order.amountMicros * 300n) / 10_000n;
    const capture: PayPalCaptureDetails = {
      captureId: `CAP_${order.orderId.slice(4)}`,
      status: order.nextCaptureStatus,
      grossMicros: order.amountMicros,
      feeMicros,
      netMicros: order.amountMicros - feeMicros,
    };
    order.capture = capture;
    order.orderStatus = capture.status === "COMPLETED" ? "COMPLETED" : "APPROVED";
    return capture;
  }

  async getOrder(orderId: string): Promise<{
    orderId: string;
    orderStatus: string;
    customId?: string | undefined;
    capture?: PayPalCaptureDetails | undefined;
  }> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`PayPal order ${orderId} not found`);
    }
    return {
      orderId: order.orderId,
      orderStatus: order.orderStatus,
      customId: order.topupId,
      capture: order.capture,
    };
  }

  async createPayoutBatch(params: {
    batchRef: string;
    items: ReadonlyArray<{
      payoutId: string;
      receiverPayerId: string;
      amountMicros: bigint;
    }>;
  }): Promise<{ paypalBatchId: string }> {
    // Duplicate sender_batch_id recovery (SPEC 7.2 step 4)
    const existingBatchId = this.batchIdByRef.get(params.batchRef);
    if (existingBatchId) {
      return { paypalBatchId: existingBatchId };
    }
    const paypalBatchId = `PBA_${createId("pot").slice(4)}`;
    const status = this.nextPayoutItemStatusOverride;
    const items: PayPalPayoutItemDetails[] = params.items.map((item) => ({
      payoutItemId: `PIT_${item.payoutId.slice(4)}`,
      senderItemId: item.payoutId,
      transactionStatus: status,
      amountMicros: item.amountMicros,
      feeMicros: 250_000n, // $0.25 mock payout item fee
      ...(status === "FAILED" || status === "DENIED"
        ? { failureReason: "RECEIVER_UNREGISTERED" }
        : {}),
    }));
    this.payoutBatches.set(paypalBatchId, {
      paypalBatchId,
      batchRef: params.batchRef,
      batchStatus: status === "SUCCESS" ? "SUCCESS" : "PROCESSING",
      items,
    });
    this.batchIdByRef.set(params.batchRef, paypalBatchId);
    return { paypalBatchId };
  }

  async getPayoutBatch(paypalBatchId: string): Promise<{
    paypalBatchId: string;
    batchStatus: string;
    items: PayPalPayoutItemDetails[];
  }> {
    const batch = this.payoutBatches.get(paypalBatchId);
    if (!batch) {
      throw new Error(`PayPal payout batch ${paypalBatchId} not found`);
    }
    return {
      paypalBatchId: batch.paypalBatchId,
      batchStatus: batch.batchStatus,
      items: batch.items.map((i) => ({ ...i })),
    };
  }

  buildAuthorizeUrl(params: { state: string; redirectUri: string }): string {
    const scope = encodeURIComponent(
      "openid profile email https://uri.paypal.com/services/paypalattributes",
    );
    return `${SANDBOX_AUTH_URL}?flowEntry=static&client_id=mock_client_id&response_type=code&scope=${scope}&redirect_uri=${encodeURIComponent(params.redirectUri)}&state=${encodeURIComponent(params.state)}`;
  }

  async exchangeCodeForUserInfo(params: {
    code: string;
    redirectUri: string;
  }): Promise<PayPalUserIdentity> {
    const registered = this.mockUsersByCode.get(params.code);
    if (registered) {
      return registered;
    }
    if (params.code.startsWith("invalid")) {
      throw new Error("Invalid OAuth2 authorization code");
    }
    return {
      paypalUserId: `https://www.paypal.com/webapps/auth/identity/user/${params.code}`,
      paypalPayerId: `PAYER_${params.code.toUpperCase()}`,
      email: `${params.code.toLowerCase()}@sandbox.paypal.example.com`,
      displayName: `Sandbox User (${params.code})`,
      verifiedAccount: true,
    };
  }

  async verifyWebhookSignature(params: {
    headers: Record<string, string | undefined>;
    rawBody: string;
  }): Promise<boolean> {
    const sig = params.headers["paypal-transmission-sig"];
    const transmissionId = params.headers["paypal-transmission-id"];
    if (!sig || !transmissionId || !params.rawBody) {
      return false;
    }
    return sig === "mock-valid-signature";
  }
}

/**
 * Real PayPal Sandbox REST API gateway (`PAYPAL_MODE=sandbox`, SPEC.md sections 7.1, 7.2, 8.3, 8.5, Appendix C).
 *
 * @example
 * ```ts
 * const gateway = new SandboxPayPalGateway(config);
 * ```
 */
export class SandboxPayPalGateway implements PayPalGateway {
  readonly mode = "sandbox" as const;
  private readonly config: ApiConfig;
  private readonly fetchImpl: typeof globalThis.fetch;
  private cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

  constructor(config: ApiConfig, fetchImpl: typeof globalThis.fetch = globalThis.fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      this.cachedToken &&
      Date.now() + TOKEN_REFRESH_MARGIN_MS < this.cachedToken.expiresAtMs
    ) {
      return this.cachedToken.accessToken;
    }
    const clientId = this.config.PAYPAL_CLIENT_ID!;
    const clientSecret = this.config.PAYPAL_CLIENT_SECRET!;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${SANDBOX_API_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(`PayPal OAuth2 token request failed with HTTP ${res.status}`);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token || typeof body.expires_in !== "number") {
      throw new Error("PayPal OAuth2 token response missing access_token or expires_in");
    }
    this.cachedToken = {
      accessToken: body.access_token,
      expiresAtMs: Date.now() + body.expires_in * 1000,
    };
    return this.cachedToken.accessToken;
  }

  private async requestWithAuth(
    path: string,
    init: RequestInit & { requestId?: string | undefined },
  ): Promise<Response> {
    const attempt = async (forceRefresh: boolean): Promise<Response> => {
      const token = await this.getAccessToken(forceRefresh);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
      };
      return this.fetchImpl(`${SANDBOX_API_BASE}${path}`, {
        ...init,
        headers,
      });
    };

    let res = await attempt(false);
    if (res.status === 401) {
      res = await attempt(true);
    }
    return res;
  }

  private extractCaptureDetails(
    unitRecord: Record<string, unknown> | undefined,
    fallbackAmountMicros?: bigint,
  ): PayPalCaptureDetails | undefined {
    const payments = unitRecord?.payments as Record<string, unknown> | undefined;
    const captures = Array.isArray(payments?.captures) ? payments.captures : [];
    const cap = captures[0] as Record<string, unknown> | undefined;
    if (!cap || typeof cap.id !== "string") return undefined;

    const rawStatus = typeof cap.status === "string" ? cap.status : "FAILED";
    const status: PayPalCaptureDetails["status"] =
      rawStatus === "COMPLETED" || rawStatus === "PENDING" || rawStatus === "DECLINED"
        ? rawStatus
        : "FAILED";

    const capAmount = cap.amount as { value?: string } | undefined;
    const grossMicros = capAmount?.value
      ? parseMoney(capAmount.value)
      : (fallbackAmountMicros ?? 0n);

    const breakdown = cap.seller_receivable_breakdown as
      | {
          paypal_fee?: { value?: string };
          net_amount?: { value?: string };
        }
      | undefined;
    const feeMicros = breakdown?.paypal_fee?.value
      ? parseMoney(breakdown.paypal_fee.value)
      : 0n;
    const netMicros = breakdown?.net_amount?.value
      ? parseMoney(breakdown.net_amount.value)
      : grossMicros - feeMicros;

    return {
      captureId: cap.id,
      status,
      grossMicros,
      feeMicros,
      netMicros,
    };
  }

  async createOrder(params: {
    topupId: string;
    amountMicros: bigint;
  }): Promise<{ orderId: string; approveUrl: string }> {
    const value = formatMoney(params.amountMicros);
    const res = await this.requestWithAuth("/v2/checkout/orders", {
      method: "POST",
      requestId: params.topupId,
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: params.topupId,
            amount: { currency_code: "USD", value },
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`PayPal createOrder failed with HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      id?: string;
      links?: Array<{ rel?: string; href?: string }>;
    };
    const approveUrl = data.links?.find((l) => l.rel === "approve")?.href ?? "";
    if (!data.id) {
      throw new Error("PayPal createOrder response missing order id");
    }
    return { orderId: data.id, approveUrl };
  }

  async captureOrder(params: {
    topupId: string;
    orderId: string;
  }): Promise<PayPalCaptureDetails> {
    const res = await this.requestWithAuth(`/v2/checkout/orders/${params.orderId}/capture`, {
      method: "POST",
      requestId: `${params.topupId}:capture`,
    });
    if (!res.ok) {
      throw new Error(`PayPal captureOrder failed with HTTP ${res.status}`);
    }
    const data = (await res.json()) as { purchase_units?: Array<Record<string, unknown>> };
    const details = this.extractCaptureDetails(data.purchase_units?.[0]);
    if (!details) {
      throw new Error("PayPal captureOrder response missing purchase_units[0].payments.captures[0]");
    }
    return details;
  }

  async getOrder(orderId: string): Promise<{
    orderId: string;
    orderStatus: string;
    customId?: string | undefined;
    capture?: PayPalCaptureDetails | undefined;
  }> {
    const res = await this.requestWithAuth(`/v2/checkout/orders/${orderId}`, {
      method: "GET",
    });
    if (!res.ok) {
      throw new Error(`PayPal getOrder failed with HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      id?: string;
      status?: string;
      purchase_units?: Array<Record<string, unknown>>;
    };
    const unit = data.purchase_units?.[0];
    const customId = typeof unit?.custom_id === "string" ? unit.custom_id : undefined;
    const capture = this.extractCaptureDetails(unit);
    return {
      orderId: data.id ?? orderId,
      orderStatus: data.status ?? "UNKNOWN",
      customId,
      capture,
    };
  }

  async createPayoutBatch(params: {
    batchRef: string;
    items: ReadonlyArray<{
      payoutId: string;
      receiverPayerId: string;
      amountMicros: bigint;
    }>;
  }): Promise<{ paypalBatchId: string }> {
    const res = await this.requestWithAuth("/v1/payments/payouts", {
      method: "POST",
      requestId: params.batchRef,
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: params.batchRef,
          recipient_type: "PAYPAL_ID",
          email_subject: "Your Haggles earnings",
        },
        items: params.items.map((item) => ({
          recipient_type: "PAYPAL_ID",
          receiver: item.receiverPayerId,
          amount: { value: formatMoney(item.amountMicros), currency: "USD" },
          sender_item_id: item.payoutId,
        })),
      }),
    });

    const body = (await res.json()) as {
      batch_header?: { payout_batch_id?: string };
      links?: Array<{ rel?: string; href?: string }>;
    };

    if (res.ok && body.batch_header?.payout_batch_id) {
      return { paypalBatchId: body.batch_header.payout_batch_id };
    }

    // Duplicate sender_batch_id crash recovery (SPEC 7.2 step 4 & Appendix C)
    const originalLink = body.links?.find((l) => l.href?.includes("/v1/payments/payouts/"))?.href;
    if (originalLink) {
      const match = /\/v1\/payments\/payouts\/([A-Za-z0-9_-]+)/.exec(originalLink);
      if (match?.[1]) {
        return { paypalBatchId: match[1] };
      }
    }

    throw new Error(`PayPal createPayoutBatch failed with HTTP ${res.status}`);
  }

  async getPayoutBatch(paypalBatchId: string): Promise<{
    paypalBatchId: string;
    batchStatus: string;
    items: PayPalPayoutItemDetails[];
  }> {
    const res = await this.requestWithAuth(`/v1/payments/payouts/${paypalBatchId}`, {
      method: "GET",
    });
    if (!res.ok) {
      throw new Error(`PayPal getPayoutBatch failed with HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      batch_header?: { payout_batch_id?: string; batch_status?: string };
      items?: Array<{
        payout_item_id?: string;
        transaction_status?: string;
        payout_item_fee?: { value?: string };
        payout_item?: { sender_item_id?: string; amount?: { value?: string } };
        errors?: { name?: string; message?: string };
      }>;
    };

    const items: PayPalPayoutItemDetails[] = (data.items ?? []).map((item) => ({
      payoutItemId: item.payout_item_id ?? "",
      senderItemId: item.payout_item?.sender_item_id ?? "",
      transactionStatus: (item.transaction_status ??
        "PROCESSING") as PayPalPayoutItemDetails["transactionStatus"],
      amountMicros: item.payout_item?.amount?.value
        ? parseMoney(item.payout_item.amount.value)
        : 0n,
      feeMicros: item.payout_item_fee?.value ? parseMoney(item.payout_item_fee.value) : null,
      failureReason: item.errors?.name ?? item.errors?.message,
    }));

    return {
      paypalBatchId: data.batch_header?.payout_batch_id ?? paypalBatchId,
      batchStatus: data.batch_header?.batch_status ?? "UNKNOWN",
      items,
    };
  }

  buildAuthorizeUrl(params: { state: string; redirectUri: string }): string {
    const scope = encodeURIComponent(
      "openid profile email https://uri.paypal.com/services/paypalattributes",
    );
    return `${SANDBOX_AUTH_URL}?flowEntry=static&client_id=${encodeURIComponent(this.config.PAYPAL_CLIENT_ID ?? "")}&response_type=code&scope=${scope}&redirect_uri=${encodeURIComponent(params.redirectUri)}&state=${encodeURIComponent(params.state)}`;
  }

  async exchangeCodeForUserInfo(params: {
    code: string;
    redirectUri: string;
  }): Promise<PayPalUserIdentity> {
    const clientId = this.config.PAYPAL_CLIENT_ID!;
    const clientSecret = this.config.PAYPAL_CLIENT_SECRET!;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const bodyParams = new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
    });

    const tokenRes = await this.fetchImpl(`${SANDBOX_API_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: bodyParams.toString(),
    });
    if (!tokenRes.ok) {
      const errBody = (await tokenRes.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      const detail = errBody.error_description ?? errBody.error ?? `HTTP ${tokenRes.status}`;
      throw new Error(`PayPal OIDC token exchange failed (${detail})`);
    }
    const tokenBody = (await tokenRes.json()) as { access_token?: string };
    if (!tokenBody.access_token) {
      throw new Error("PayPal OIDC token response missing access_token");
    }

    const userRes = await this.fetchImpl(
      `${SANDBOX_API_BASE}/v1/identity/oauth2/userinfo?schema=paypalv1.1`,
      {
        headers: {
          Authorization: `Bearer ${tokenBody.access_token}`,
        },
      },
    );
    if (!userRes.ok) {
      throw new Error(`PayPal OIDC userinfo request failed with HTTP ${userRes.status}`);
    }
    const userInfo = (await userRes.json()) as {
      user_id?: string;
      sub?: string;
      payer_id?: string;
      name?: string;
      email?: string;
      verified_account?: boolean | string;
      emails?: Array<{ value?: string; primary?: boolean; confirmed?: boolean }>;
    };

    const paypalUserId = userInfo.user_id ?? userInfo.sub;
    const paypalPayerId = userInfo.payer_id;
    const primaryConfirmed =
      userInfo.emails?.find((e) => e.primary && e.confirmed)?.value ??
      userInfo.emails?.find((e) => e.primary)?.value ??
      userInfo.emails?.[0]?.value ??
      userInfo.email;

    if (!paypalUserId || !paypalPayerId || !primaryConfirmed) {
      throw new Error(
        "PayPal userinfo response missing required user_id, payer_id, or primary email (ensure Personal Info -> Email and Account Info -> Account status/Payer ID are enabled under Log in with PayPal -> Advanced Options)",
      );
    }

    return {
      paypalUserId,
      paypalPayerId,
      email: primaryConfirmed,
      displayName: userInfo.name ?? null,
      verifiedAccount:
        userInfo.verified_account === true || userInfo.verified_account === "true",
    };
  }

  async verifyWebhookSignature(params: {
    headers: Record<string, string | undefined>;
    rawBody: string;
  }): Promise<boolean> {
    const authAlgo = params.headers["paypal-auth-algo"];
    const certUrl = params.headers["paypal-cert-url"];
    const transmissionId = params.headers["paypal-transmission-id"];
    const transmissionSig = params.headers["paypal-transmission-sig"];
    const transmissionTime = params.headers["paypal-transmission-time"];
    const webhookId = this.config.PAYPAL_WEBHOOK_ID;

    if (
      !authAlgo ||
      !certUrl ||
      !transmissionId ||
      !transmissionSig ||
      !transmissionTime ||
      !webhookId
    ) {
      return false;
    }

    let webhookEvent: unknown;
    try {
      webhookEvent = JSON.parse(params.rawBody);
    } catch {
      return false;
    }

    const res = await this.requestWithAuth("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      requestId: `wh-verify-${transmissionId}`,
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: webhookEvent,
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { verification_status?: string };
    return data.verification_status === "SUCCESS";
  }
}
