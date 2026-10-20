/**
 * `@haggles/client` — Haggles buyer SDK (SPEC.md sections 4.9 and 10.2).
 *
 * Provides `createHaggles` and `readReceipt` so AI agents and services can seamlessly pay
 * HTTP `402 Payment Required` challenges issued by Haggles-enabled sellers.
 */

import {
  type Challenge,
  ChallengeMismatchError,
  ChallengeSchema,
  canonicalizeUrl,
  decodeChallenge,
  FacilitatorUnavailableError,
  formatMoney,
  HagglesError,
  type HagglesErrorCode,
  HEADERS,
  InsufficientFundsError,
  InvalidChallengeError,
  NonReplayableBodyError,
  parseMoney,
  PaymentNotAcceptedError,
  PolicyViolationError,
  type ProblemDetails,
  ReceiptClaimsSchema,
} from "@haggles/core";

/**
 * Payment event emitted to the `onPayment` callback when a `402` challenge is authorized (SPEC.md section 10.2).
 *
 * @example
 * ```ts
 * const onPayment = (e: HagglesPaymentEvent) => console.log(e.paymentId, e.amount);
 * ```
 */
export interface HagglesPaymentEvent {
  paymentId: string;
  amount: string;
  url: string;
  sellerId: string;
  challengeId: string;
}

/**
 * Parsed receipt returned by {@link readReceipt} from a seller's `Haggles-Receipt` header (SPEC.md sections 4.5 and 10.2).
 *
 * @example
 * ```ts
 * const receipt = readReceipt(response);
 * if (receipt) console.log(receipt.paymentId, receipt.amount);
 * ```
 */
export interface HagglesReceipt {
  paymentId: string;
  amount: string;
  currency: "USD";
  method: string;
  url: string;
  sellerId: string;
  capturedAt: string;
  raw: string;
}

/**
 * Wallet balance and remaining policy allowance returned by `haggles.balance()` (SPEC.md sections 5.1 and 10.2).
 *
 * @example
 * ```ts
 * const bal = await haggles.balance();
 * console.log(bal.available, bal.allowance.dailyRemaining);
 * ```
 */
export interface HagglesBalance {
  available: string;
  held: string;
  currency: "USD";
  allowance: {
    perCallMax: string;
    dailyRemaining: string;
    monthlyRemaining: string | null;
  };
}

/**
 * Configuration options for {@link createHaggles} (SPEC.md section 10.2).
 *
 * @example
 * ```ts
 * const haggles = createHaggles({
 *   agentKey: process.env.HAGGLES_KEY!,
 *   maxPricePerCall: "0.10",
 * });
 * ```
 */
export interface CreateHagglesOptions {
  /** Required buyer agent API key (`hgk_<env>_...`) */
  agentKey: string;
  /** Facilitator base URL (defaults to `process.env.HAGGLES_FACILITATOR_URL` or `"http://localhost:3001"`) */
  facilitatorUrl?: string | undefined;
  /** Optional client-side maximum price per call in USD decimal string (e.g. `"0.10"`) */
  maxPricePerCall?: string | undefined;
  /** Whether to buffer `ReadableStream` request bodies in memory so they can be replayed on `402` (default `false`, SPEC.md section 4.9 rule 5) */
  bufferBody?: boolean | undefined;
  /** Facilitator request timeout in milliseconds (default `10_000`) */
  timeoutMs?: number | undefined;
  /** Injectable `fetch` implementation for tests (default `globalThis.fetch`) */
  fetch?: typeof globalThis.fetch | undefined;
  /** Hook invoked whenever a payment is authorized for a `402` challenge */
  onPayment?: ((event: HagglesPaymentEvent) => void) | undefined;
  /** Hook invoked whenever a Haggles protocol or facilitator error occurs */
  onError?: ((error: HagglesError) => void) | undefined;
}

/**
 * Haggles client instance returned by {@link createHaggles} (SPEC.md section 10.2).
 *
 * @example
 * ```ts
 * const res = await haggles.fetch("https://poems.example.com/poems/42");
 * ```
 */
export interface HagglesClient {
  /** Drop-in `fetch` replacement that automatically handles HTTP `402` Haggles challenges */
  fetch: typeof globalThis.fetch;
  /** Queries `GET /v1/wallet` for current available/held balance and remaining policy allowance */
  balance: () => Promise<HagglesBalance>;
  /** Wraps an arbitrary `fetch`-compatible function with Haggles `402` handling */
  wrap: (baseFetch: typeof globalThis.fetch) => typeof globalThis.fetch;
}

function isReadableStream(body: unknown): body is ReadableStream<Uint8Array> {
  return (
    typeof body === "object" &&
    body !== null &&
    "getReader" in body &&
    typeof (body as ReadableStream).getReader === "function"
  );
}

async function readStreamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLength += value.byteLength;
    }
  }
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

/**
 * Extracts and validates a Haggles challenge from a `402` response, checking the
 * `Haggles-Payment-Required` header first and falling back to the JSON body (SPEC.md sections 4.1 and 4.9 rule 2).
 * Returns `null` if the `402` response is not a Haggles challenge.
 */
async function tryExtractHagglesChallenge(response: Response): Promise<Challenge | null> {
  const headerVal = response.headers.get(HEADERS.required);
  if (headerVal && headerVal.trim().length > 0) {
    return decodeChallenge(headerVal);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  let bodyJson: unknown;
  try {
    bodyJson = await response.clone().json();
  } catch {
    return null;
  }

  if (
    typeof bodyJson !== "object" ||
    bodyJson === null ||
    (bodyJson as { protocol?: unknown }).protocol !== "haggles"
  ) {
    return null;
  }

  const parsed = ChallengeSchema.safeParse(bodyJson);
  if (!parsed.success) {
    throw new InvalidChallengeError(
      `Invalid Haggles 402 JSON challenge body: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/**
 * Converts an RFC 9457 `application/problem+json` response from the facilitator into a typed {@link HagglesError}.
 */
function mapProblemToError(status: number, problem: Partial<ProblemDetails> | null): HagglesError {
  const code = (problem?.code ?? "internal_error") as HagglesErrorCode;
  const detail = problem?.detail ?? problem?.title ?? `Facilitator returned HTTP ${status}.`;
  const requestId = problem?.request_id;

  switch (code) {
    case "policy_violation":
      return new PolicyViolationError(detail, { requestId });
    case "insufficient_funds":
      return new InsufficientFundsError(detail, { requestId });
    case "invalid_challenge":
      return new InvalidChallengeError(detail, { requestId });
    case "request_mismatch":
    case "amount_mismatch":
      return new ChallengeMismatchError(detail, { requestId });
    default:
      return new HagglesError(detail, { code, status, requestId });
  }
}

/**
 * Reads and decodes the `Haggles-Receipt` JWS header from a `Response` (SPEC.md sections 4.5, 4.9 rule 6, and 10.2).
 *
 * Returns `null` if the response does not carry a `Haggles-Receipt` header.
 *
 * @param response - Fetch `Response` from a paid request
 * @returns Parsed {@link HagglesReceipt} or `null`
 *
 * @example
 * ```ts
 * const res = await haggles.fetch("https://poems.example.com/poems/42");
 * const receipt = readReceipt(res);
 * if (receipt) {
 *   console.log(receipt.paymentId, receipt.amount);
 * }
 * ```
 */
export function readReceipt(response: Response): HagglesReceipt | null {
  const raw = response.headers.get(HEADERS.receipt);
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  const parts = raw.trim().split(".");
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = ReceiptClaimsSchema.safeParse(JSON.parse(payloadJson));
    if (!parsed.success) {
      return null;
    }
    const claims = parsed.data;
    return {
      paymentId: claims.sub,
      amount: claims.amount,
      currency: claims.currency,
      method: claims.method,
      url: claims.url,
      sellerId: claims.aud,
      capturedAt: claims.captured_at,
      raw: raw.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Creates a Haggles buyer SDK client (`SPEC.md` sections 4.9 and 10.2).
 *
 * @param options - Client configuration options
 * @returns {@link HagglesClient} instance with `.fetch`, `.balance`, and `.wrap`
 *
 * @example
 * ```ts
 * const haggles = createHaggles({
 *   agentKey: process.env.HAGGLES_KEY!,
 *   facilitatorUrl: "https://api.haggles.example.com",
 *   maxPricePerCall: "0.10",
 * });
 * const res = await haggles.fetch("https://poems.example.com/poems/42");
 * ```
 */
export function createHaggles(options: CreateHagglesOptions): HagglesClient {
  if (!options.agentKey || !options.agentKey.startsWith("hgk_")) {
    throw new HagglesError(
      'Invalid agentKey: expected a buyer agent key starting with "hgk_".',
      { code: "unauthorized", status: 401 },
    );
  }

  const facilitatorBaseUrl = (
    options.facilitatorUrl ??
    process.env.HAGGLES_FACILITATOR_URL ??
    "http://localhost:3001"
  ).replace(/\/$/, "");

  const maxPriceMicros =
    options.maxPricePerCall !== undefined ? parseMoney(options.maxPricePerCall) : null;
  const bufferBody = options.bufferBody ?? false;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const defaultFetch = options.fetch ?? globalThis.fetch;

  const notifyError = (err: HagglesError): never => {
    options.onError?.(err);
    throw err;
  };

  /**
   * Calls `POST /v1/payments` on the facilitator with up to 2 retries on network/`5xx` errors
   * using the **same** `Idempotency-Key: <challenge_id>` (SPEC.md section 4.9 rule 4 & 10.2).
   * Never retries on `4xx`.
   */
  const authorizeWithFacilitator = async (
    fetchImpl: typeof globalThis.fetch,
    challenge: Challenge,
  ): Promise<{ payment_id: string; token: string; amount: string }> => {
    const endpoint = `${facilitatorBaseUrl}/v1/payments`;
    const maxAttempts = 3; // initial call + up to 2 retries on network/5xx
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.agentKey}`,
            "content-type": "application/json",
            "idempotency-key": challenge.challenge_id,
          },
          body: JSON.stringify({ challenge }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        lastError = cause;
        if (attempt < maxAttempts) continue;
        return notifyError(
          new FacilitatorUnavailableError(
            `Facilitator at ${facilitatorBaseUrl} is unreachable after ${maxAttempts} attempts.`,
            { cause },
          ),
        );
      }

      if (res.status === 201 || res.status === 200) {
        const data = (await res.json()) as {
          payment_id: string;
          token: string;
          amount: string;
        };
        return data;
      }

      if (res.status >= 400 && res.status < 500) {
        let problem: Partial<ProblemDetails> | null = null;
        try {
          problem = (await res.json()) as Partial<ProblemDetails>;
        } catch {
          problem = null;
        }
        return notifyError(mapProblemToError(res.status, problem));
      }

      // 5xx error -> retry up to maxAttempts with the same Idempotency-Key
      lastError = new Error(`Facilitator returned HTTP ${res.status}`);
      if (attempt === maxAttempts) {
        return notifyError(
          new FacilitatorUnavailableError(
            `Facilitator at ${facilitatorBaseUrl} returned HTTP ${res.status} after ${maxAttempts} attempts.`,
            { cause: lastError },
          ),
        );
      }
    }

    return notifyError(
      new FacilitatorUnavailableError("Facilitator authorization failed.", { cause: lastError }),
    );
  };

  const wrap = (baseFetch: typeof globalThis.fetch): typeof globalThis.fetch => {
    const paidFetch: typeof globalThis.fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      let requestUrl: string;
      let requestMethod: string;
      let baseHeaders: Headers;
      let replayableBody: RequestInit["body"];
      let streamBodyDetected = false;

      if (input instanceof Request) {
        requestUrl = input.url;
        requestMethod = (init?.method ?? input.method ?? "GET").toUpperCase();
        baseHeaders = new Headers(input.headers);
        if (init?.headers) {
          const extra = new Headers(init.headers);
          extra.forEach((v, k) => baseHeaders.set(k, v));
        }

        if (init?.body !== undefined) {
          if (isReadableStream(init.body)) {
            if (bufferBody) {
              replayableBody = new Uint8Array(await readStreamToUint8Array(init.body));
            } else {
              streamBodyDetected = true;
              replayableBody = init.body;
            }
          } else {
            replayableBody = init.body;
          }
        } else if (input.body !== null) {
          if (bufferBody) {
            const ab = await input.clone().arrayBuffer();
            replayableBody = new Uint8Array(ab);
          } else {
            // Check whether Request was constructed with a stream or can be cloned
            try {
              const cloned = input.clone();
              const ab = await cloned.arrayBuffer();
              replayableBody = new Uint8Array(ab);
            } catch {
              streamBodyDetected = true;
            }
          }
        }
      } else {
        requestUrl = typeof input === "string" ? input : input.toString();
        requestMethod = (init?.method ?? "GET").toUpperCase();
        baseHeaders = new Headers(init?.headers);
        if (init?.body !== undefined && init?.body !== null) {
          if (isReadableStream(init.body)) {
            if (bufferBody) {
              replayableBody = new Uint8Array(await readStreamToUint8Array(init.body));
            } else {
              streamBodyDetected = true;
              replayableBody = init.body;
            }
          } else {
            replayableBody = init.body;
          }
        }
      }

      // 1. Send the original request unchanged (SPEC 4.9 rule 1)
      const firstInit: RequestInit = {
        ...init,
        method: requestMethod,
        headers: new Headers(baseHeaders),
      };
      if (replayableBody !== undefined) {
        firstInit.body = replayableBody;
      }

      const firstResponse =
        input instanceof Request && streamBodyDetected
          ? await baseFetch(input, init)
          : await baseFetch(requestUrl, firstInit);

      if (firstResponse.status !== 402) {
        return firstResponse;
      }

      // 2. Check if this 402 carries a Haggles challenge (SPEC 4.9 rule 2)
      let challenge: Challenge | null;
      try {
        challenge = await tryExtractHagglesChallenge(firstResponse);
      } catch (err) {
        if (err instanceof HagglesError) {
          return notifyError(err);
        }
        throw err;
      }
      if (!challenge) {
        return firstResponse;
      }

      // 3. Before paying, ensure the request body is replayable (SPEC 4.9 rule 5)
      if (streamBodyDetected) {
        return notifyError(
          new NonReplayableBodyError(
            "Cannot replay a ReadableStream request body on HTTP 402; pass a replayable body (string, Uint8Array, URLSearchParams) or set bufferBody: true.",
          ),
        );
      }

      // 4. Validate URL and method match (SPEC 4.3 & 4.9 rule 3)
      const effectiveResponseUrl =
        firstResponse.url && firstResponse.url.length > 0 ? firstResponse.url : requestUrl;
      const canonicalChallengeUrl = canonicalizeUrl(challenge.url);
      const canonicalResponseUrl = canonicalizeUrl(effectiveResponseUrl);

      if (canonicalChallengeUrl !== canonicalResponseUrl) {
        return notifyError(
          new ChallengeMismatchError(
            `Challenge URL "${canonicalChallengeUrl}" does not match request URL "${canonicalResponseUrl}".`,
          ),
        );
      }

      if (challenge.method.toUpperCase() !== requestMethod) {
        return notifyError(
          new ChallengeMismatchError(
            `Challenge method "${challenge.method}" does not match request method "${requestMethod}".`,
          ),
        );
      }

      // 5. Client-side maxPricePerCall guard (SPEC 4.9 rule 3 & 10.2)
      const challengeAmountMicros = parseMoney(challenge.amount);
      if (maxPriceMicros !== null && challengeAmountMicros > maxPriceMicros) {
        return notifyError(
          new PolicyViolationError(
            `Challenge price $${formatMoney(challengeAmountMicros)} exceeds client maxPricePerCall of $${formatMoney(maxPriceMicros)}.`,
          ),
        );
      }

      // 6. Authorize payment with facilitator (SPEC 4.9 rule 4)
      const authorized = await authorizeWithFacilitator(baseFetch, challenge);

      options.onPayment?.({
        paymentId: authorized.payment_id,
        amount: authorized.amount,
        url: canonicalChallengeUrl,
        sellerId: challenge.seller_id,
        challengeId: challenge.challenge_id,
      });

      // 7. Retry the original request ONCE with Haggles-Payment: <token> (SPEC 4.9 rules 5 & 7)
      const retryHeaders = new Headers(baseHeaders);
      retryHeaders.set(HEADERS.payment, authorized.token);
      const retryInit: RequestInit = {
        ...init,
        method: requestMethod,
        headers: retryHeaders,
      };
      if (replayableBody !== undefined) {
        retryInit.body = replayableBody;
      }

      const secondResponse = await baseFetch(requestUrl, retryInit);
      if (secondResponse.status === 402) {
        return notifyError(
          new PaymentNotAcceptedError(
            `Seller ${challenge.seller_id} returned HTTP 402 again after payment ${authorized.payment_id} was submitted.`,
          ),
        );
      }

      return secondResponse;
    };

    return paidFetch;
  };

  const balance = async (): Promise<HagglesBalance> => {
    const endpoint = `${facilitatorBaseUrl}/v1/wallet`;
    let res: Response;
    try {
      res = await defaultFetch(endpoint, {
        method: "GET",
        headers: {
          authorization: `Bearer ${options.agentKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      return notifyError(
        new FacilitatorUnavailableError(
          `Facilitator at ${facilitatorBaseUrl} is unreachable.`,
          { cause },
        ),
      );
    }

    if (!res.ok) {
      let problem: Partial<ProblemDetails> | null = null;
      try {
        problem = (await res.json()) as Partial<ProblemDetails>;
      } catch {
        problem = null;
      }
      return notifyError(mapProblemToError(res.status, problem));
    }

    const raw = (await res.json()) as {
      available: string;
      held: string;
      currency: "USD";
      allowance: {
        per_call_max: string;
        daily_remaining: string;
        monthly_remaining: string | null;
      };
    };

    return {
      available: raw.available,
      held: raw.held,
      currency: raw.currency,
      allowance: {
        perCallMax: raw.allowance.per_call_max,
        dailyRemaining: raw.allowance.daily_remaining,
        monthlyRemaining: raw.allowance.monthly_remaining,
      },
    };
  };

  return {
    fetch: wrap(defaultFetch),
    balance,
    wrap,
  };
}
