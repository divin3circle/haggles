/**
 * `@haggles/client` unit and protocol compliance tests (SPEC.md sections 4.9, 10.2, 15.1).
 */

import {
  type Challenge,
  ChallengeMismatchError,
  encodeChallenge,
  FacilitatorUnavailableError,
  HEADERS,
  InsufficientFundsError,
  NonReplayableBodyError,
  PaymentNotAcceptedError,
  PolicyViolationError,
} from "@haggles/core";
import { describe, expect, it } from "vitest";
import { createHaggles, type HagglesPaymentEvent, readReceipt } from "../src/index.js";

const SAMPLE_AGENT_KEY = "hgk_test_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg";
const FACILITATOR_URL = "https://api.haggles.example.com";

function makeSampleChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    protocol: "haggles",
    version: 1,
    scheme: "prepaid-usd",
    challenge_id: "chl_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
    amount: "0.02",
    currency: "USD",
    method: "GET",
    url: "https://poems.example.com/poems/42",
    seller_id: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
    description: "One poem",
    facilitator: FACILITATOR_URL,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function makeSampleReceiptJws(): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: "haggles-receipt+jwt", kid: "kid_1" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: FACILITATOR_URL,
      sub: "pay_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
      aud: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
      iat: 1700000000,
      amount: "0.02",
      currency: "USD",
      method: "GET",
      url: "https://poems.example.com/poems/42",
      captured_at: "2026-10-06T12:00:01.000Z",
    }),
  ).toString("base64url");
  return `${header}.${payload}.fakesig`;
}

describe("@haggles/client — SPEC.md sections 4.9 and 10.2", () => {
  it("passes non-402 responses and non-Haggles 402 responses through untouched without calling the facilitator", async () => {
    let facilitatorCalled = false;
    const mockFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith(FACILITATOR_URL)) {
        facilitatorCalled = true;
        return new Response("unexpected", { status: 500 });
      }
      if (url.endsWith("/free")) {
        return new Response(JSON.stringify({ free: true }), { status: 200 });
      }
      // Some other 402 without Haggles header or body
      return new Response("Stripe subscription required", { status: 402 });
    };

    const haggles = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      fetch: mockFetch,
    });

    const freeRes = await haggles.fetch("https://poems.example.com/free");
    expect(freeRes.status).toBe(200);
    expect(readReceipt(freeRes)).toBeNull();

    const other402Res = await haggles.fetch("https://poems.example.com/other-402");
    expect(other402Res.status).toBe(402);
    expect(await other402Res.text()).toBe("Stripe subscription required");
    expect(facilitatorCalled).toBe(false);
  });

  it("handles a 402 challenge end-to-end, emits onPayment, attaches Haggles-Payment on retry, and parses Haggles-Receipt", async () => {
    const challenge = makeSampleChallenge();
    const receiptJws = makeSampleReceiptJws();
    const events: HagglesPaymentEvent[] = [];
    let sellerCalls = 0;

    const mockFetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === `${FACILITATOR_URL}/v1/payments`) {
        const headers = new Headers(init?.headers);
        expect(headers.get("idempotency-key")).toBe(challenge.challenge_id);
        expect(headers.get("authorization")).toBe(`Bearer ${SAMPLE_AGENT_KEY}`);
        return new Response(
          JSON.stringify({
            payment_id: "pay_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
            token: "eyJhbGciOiJFZERTQSJ9.token.sig",
            amount: "0.02",
            currency: "USD",
            expires_at: challenge.expires_at,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }

      sellerCalls++;
      const headers = new Headers(init?.headers);
      const token = headers.get(HEADERS.payment);
      if (!token) {
        return new Response(JSON.stringify(challenge), {
          status: 402,
          headers: {
            "content-type": "application/json",
            [HEADERS.required]: encodeChallenge(challenge),
          },
        });
      }

      expect(token).toBe("eyJhbGciOiJFZERTQSJ9.token.sig");
      return new Response(JSON.stringify({ poem: "Two roads diverged in a yellow wood" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          [HEADERS.receipt]: receiptJws,
        },
      });
    };

    const haggles = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      fetch: mockFetch,
      onPayment: (e) => events.push(e),
    });

    const res = await haggles.fetch("https://poems.example.com/poems/42");
    expect(res.status).toBe(200);
    expect(sellerCalls).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      paymentId: "pay_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
      amount: "0.02",
      sellerId: challenge.seller_id,
    });

    const receipt = readReceipt(res);
    expect(receipt).not.toBeNull();
    expect(receipt?.paymentId).toBe("pay_01J9Z3K4M5N6P7Q8R9S0T1U2V3");
    expect(receipt?.amount).toBe("0.02");
    expect(receipt?.raw).toBe(receiptJws);
  });

  it("rejects URL mismatch and method mismatch before calling the facilitator (SPEC 4.3 & 4.9 rule 3)", async () => {
    let facilitatorCalled = false;
    const badUrlChallenge = makeSampleChallenge({
      url: "https://attacker.example.com/poems/42",
    });

    const hagglesUrlMismatch = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      fetch: async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith(FACILITATOR_URL)) {
          facilitatorCalled = true;
        }
        return new Response(JSON.stringify(badUrlChallenge), {
          status: 402,
          headers: { [HEADERS.required]: encodeChallenge(badUrlChallenge) },
        });
      },
    });

    await expect(
      hagglesUrlMismatch.fetch("https://poems.example.com/poems/42"),
    ).rejects.toThrow(ChallengeMismatchError);
    expect(facilitatorCalled).toBe(false);

    const badMethodChallenge = makeSampleChallenge({ method: "POST" });
    const hagglesMethodMismatch = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      fetch: async () =>
        new Response(JSON.stringify(badMethodChallenge), {
          status: 402,
          headers: { [HEADERS.required]: encodeChallenge(badMethodChallenge) },
        }),
    });

    await expect(
      hagglesMethodMismatch.fetch("https://poems.example.com/poems/42"),
    ).rejects.toThrow(ChallengeMismatchError);
  });

  it("enforces client-side maxPricePerCall guard before calling the facilitator (SPEC 4.9 rule 3)", async () => {
    let facilitatorCalled = false;
    const expensiveChallenge = makeSampleChallenge({ amount: "0.25" });

    const haggles = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      maxPricePerCall: "0.10",
      fetch: async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith(FACILITATOR_URL)) facilitatorCalled = true;
        return new Response(JSON.stringify(expensiveChallenge), {
          status: 402,
          headers: { [HEADERS.required]: encodeChallenge(expensiveChallenge) },
        });
      },
    });

    await expect(haggles.fetch("https://poems.example.com/poems/42")).rejects.toThrow(
      PolicyViolationError,
    );
    expect(facilitatorCalled).toBe(false);
  });

  it("throws NonReplayableBodyError on ReadableStream bodies before paying unless bufferBody: true (SPEC 4.9 rule 5)", async () => {
    let facilitatorCalled = false;
    const postChallenge = makeSampleChallenge({ method: "POST" });

    const makeStream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"query":"rent"}'));
          controller.close();
        },
      });

    const hagglesNoBuffer = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      bufferBody: false,
      fetch: async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith(FACILITATOR_URL)) facilitatorCalled = true;
        return new Response(JSON.stringify(postChallenge), {
          status: 402,
          headers: { [HEADERS.required]: encodeChallenge(postChallenge) },
        });
      },
    });

    await expect(
      hagglesNoBuffer.fetch("https://poems.example.com/poems/42", {
        method: "POST",
        body: makeStream(),
      }),
    ).rejects.toThrow(NonReplayableBodyError);
    expect(facilitatorCalled).toBe(false);

    // With bufferBody: true, the stream is buffered and replayed on the paid retry
    const hagglesBuffered = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      bufferBody: true,
      fetch: async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === `${FACILITATOR_URL}/v1/payments`) {
          return new Response(
            JSON.stringify({
              payment_id: "pay_01J9Z3BUFFERED",
              token: "tok_buffered",
              amount: "0.02",
              currency: "USD",
              expires_at: postChallenge.expires_at,
            }),
            { status: 201 },
          );
        }
        const headers = new Headers(init?.headers);
        if (!headers.get(HEADERS.payment)) {
          return new Response(JSON.stringify(postChallenge), {
            status: 402,
            headers: { [HEADERS.required]: encodeChallenge(postChallenge) },
          });
        }
        return new Response("ok", { status: 200 });
      },
    });

    const res = await hagglesBuffered.fetch("https://poems.example.com/poems/42", {
      method: "POST",
      body: makeStream(),
    });
    expect(res.status).toBe(200);
  });

  it("retries facilitator 5xx up to 2 times with the SAME Idempotency-Key, never retries 4xx, and throws PaymentNotAcceptedError on second 402", async () => {
    const challenge = makeSampleChallenge();
    const idempotencyKeysSeen: string[] = [];
    let facilitatorAttempts = 0;

    const hagglesRetry5xx = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      fetch: async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === `${FACILITATOR_URL}/v1/payments`) {
          facilitatorAttempts++;
          const headers = new Headers(init?.headers);
          idempotencyKeysSeen.push(headers.get("idempotency-key") ?? "");
          if (facilitatorAttempts < 3) {
            return new Response("Temporary 503", { status: 503 });
          }
          return new Response(
            JSON.stringify({
              payment_id: "pay_01J9Z3RETRY",
              token: "tok_retry",
              amount: "0.02",
              currency: "USD",
              expires_at: challenge.expires_at,
            }),
            { status: 201 },
          );
        }
        const headers = new Headers(init?.headers);
        if (!headers.get(HEADERS.payment)) {
          return new Response(JSON.stringify(challenge), {
            status: 402,
            headers: { [HEADERS.required]: encodeChallenge(challenge) },
          });
        }
        return new Response("paid content", { status: 200 });
      },
    });

    const okRes = await hagglesRetry5xx.fetch("https://poems.example.com/poems/42");
    expect(okRes.status).toBe(200);
    expect(facilitatorAttempts).toBe(3);
    expect(idempotencyKeysSeen).toEqual([
      challenge.challenge_id,
      challenge.challenge_id,
      challenge.challenge_id,
    ]);

    // Facilitator 409 insufficient_funds -> never retried (only 1 attempt), throws InsufficientFundsError
    let attempts4xx = 0;
    const haggles4xx = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      fetch: async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === `${FACILITATOR_URL}/v1/payments`) {
          attempts4xx++;
          return new Response(
            JSON.stringify({
              code: "insufficient_funds",
              detail: "Available balance 0.00 is less than 0.02.",
              status: 409,
            }),
            { status: 409, headers: { "content-type": "application/problem+json" } },
          );
        }
        return new Response(JSON.stringify(challenge), {
          status: 402,
          headers: { [HEADERS.required]: encodeChallenge(challenge) },
        });
      },
    });

    await expect(haggles4xx.fetch("https://poems.example.com/poems/42")).rejects.toThrow(
      InsufficientFundsError,
    );
    expect(attempts4xx).toBe(1);

    // If seller returns 402 a second time after payment -> throws PaymentNotAcceptedError (never pays twice)
    let facilitatorPayCount = 0;
    const hagglesSecond402 = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      fetch: async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === `${FACILITATOR_URL}/v1/payments`) {
          facilitatorPayCount++;
          return new Response(
            JSON.stringify({
              payment_id: "pay_01J9Z3SECOND402",
              token: "tok_second402",
              amount: "0.02",
              currency: "USD",
              expires_at: challenge.expires_at,
            }),
            { status: 201 },
          );
        }
        return new Response(JSON.stringify(challenge), {
          status: 402,
          headers: { [HEADERS.required]: encodeChallenge(challenge) },
        });
      },
    });

    await expect(hagglesSecond402.fetch("https://poems.example.com/poems/42")).rejects.toThrow(
      PaymentNotAcceptedError,
    );
    expect(facilitatorPayCount).toBe(1);
  });

  it("queries GET /v1/wallet via haggles.balance()", async () => {
    const haggles = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      fetch: async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        expect(url).toBe(`${FACILITATOR_URL}/v1/wallet`);
        return new Response(
          JSON.stringify({
            available: "12.40",
            held: "0.02",
            currency: "USD",
            allowance: {
              per_call_max: "0.10",
              daily_remaining: "4.80",
              monthly_remaining: null,
            },
          }),
          { status: 200 },
        );
      },
    });

    const bal = await haggles.balance();
    expect(bal).toEqual({
      available: "12.40",
      held: "0.02",
      currency: "USD",
      allowance: {
        perCallMax: "0.10",
        dailyRemaining: "4.80",
        monthlyRemaining: null,
      },
    });
  });

  it("throws FacilitatorUnavailableError when facilitator network call fails across all retries", async () => {
    const challenge = makeSampleChallenge();
    const haggles = createHaggles({
      agentKey: SAMPLE_AGENT_KEY,
      facilitatorUrl: FACILITATOR_URL,
      fetch: async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === `${FACILITATOR_URL}/v1/payments`) {
          throw new Error("ECONNREFUSED");
        }
        return new Response(JSON.stringify(challenge), {
          status: 402,
          headers: { [HEADERS.required]: encodeChallenge(challenge) },
        });
      },
    });

    await expect(haggles.fetch("https://poems.example.com/poems/42")).rejects.toThrow(
      FacilitatorUnavailableError,
    );
  });
});
