import { createPublicKey, type JsonWebKeyInput, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Challenge,
  ChallengeMismatchError,
  ChallengeSchema,
   canonicalizeUrl,
  computePlatformFeeMicros,
  createId,
  decodeChallenge,
  ERROR_CATALOGUE,
  encodeChallenge,
  FacilitatorUnavailableError,
  floorToCentsMicros,
  formatMoney,
  fromProblemDetails,
  generateUlid,
  HEADERS,
  HagglesError,
  type HagglesErrorCode,
  InsufficientFundsError,
  InvalidChallengeError,
  InvalidMoneyError,
  isValidId,
  MAX_WIRE_MONEY_MICROS,
  NonReplayableBodyError,
  PAYMENT_TOKEN_TYP,
  PaymentNotAcceptedError,
  PaymentTokenClaimsSchema,
  PolicyViolationError,
  PROTOCOL_VERSION,
  RECEIPT_TYP,
  ReceiptClaimsSchema,
  parseMoney,
} from "../src/index.js";

const VECTORS_DIR = fileURLToPath(new URL("../test-vectors", import.meta.url));

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(`${VECTORS_DIR}/${filename}`, "utf8")) as T;
}

describe("@haggles/core — money test vectors and properties", () => {
  const vectors = loadJson<{
    valid: Array<{ input: string; micros: string; formatted: string }>;
    invalid: string[];
  }>("money.json");

  it("parses and formats all valid money test vectors", () => {
    for (const v of vectors.valid) {
      const parsed = parseMoney(v.input);
      expect(parsed, `parseMoney(${v.input})`).toBe(BigInt(v.micros));
      expect(formatMoney(parsed), `formatMoney(${v.micros}n)`).toBe(v.formatted);
    }
  });

  it("rejects all invalid money test vectors with InvalidMoneyError", () => {
    for (const invalidInput of vectors.invalid) {
      expect(() => parseMoney(invalidInput), `parseMoney(${invalidInput})`).toThrow(
        InvalidMoneyError,
      );
    }
  });

  it("rejects negative or out-of-range bigint values in formatMoney", () => {
    expect(() => formatMoney(-1n)).toThrow(InvalidMoneyError);
    expect(() => formatMoney(MAX_WIRE_MONEY_MICROS + 1n)).toThrow(InvalidMoneyError);
  });

  it("round-trips arbitrary micro-dollar amounts through formatMoney and parseMoney", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: MAX_WIRE_MONEY_MICROS }), (micros) => {
        const formatted = formatMoney(micros);
        expect(parseMoney(formatted)).toBe(micros);
      }),
      { numRuns: 300 },
    );
  });

  it("computes platform fees and cent flooring without losing micro-dollars", () => {
    expect(computePlatformFeeMicros(20_000n, 500)).toBe(1_000n);
    expect(computePlatformFeeMicros(100n, 500)).toBe(5n);
    expect(computePlatformFeeMicros(1n, 500)).toBe(0n);
    expect(() => computePlatformFeeMicros(-1n, 500)).toThrow(InvalidMoneyError);
    expect(() => computePlatformFeeMicros(100n, -1)).toThrow(InvalidMoneyError);
    expect(() => computePlatformFeeMicros(100n, 10_001)).toThrow(InvalidMoneyError);

    expect(floorToCentsMicros(1_239_999n)).toBe(1_230_000n);
    expect(floorToCentsMicros(9_999n)).toBe(0n);
    expect(() => floorToCentsMicros(-10_000n)).toThrow(InvalidMoneyError);

    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 500_000_000n }),
        fc.integer({ min: 0, max: 10_000 }),
        (gross, bps) => {
          const fee = computePlatformFeeMicros(gross, bps);
          const net = gross - fee;
          expect(fee >= 0n && fee <= gross).toBe(true);
          expect(net + fee).toBe(gross);

          const floored = floorToCentsMicros(gross);
          expect(floored % 10_000n).toBe(0n);
          expect(gross - floored >= 0n && gross - floored < 10_000n).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("@haggles/core — canonical URL test vectors (SPEC 4.3)", () => {
  const vectors = loadJson<{
    valid: Array<{ name: string; input: string; expected: string }>;
    invalid: string[];
  }>("urls.json");

  it("contains at least 30 canonical URL test vectors as required by SPEC 10.1", () => {
    expect(vectors.valid.length).toBeGreaterThanOrEqual(30);
  });

  it("canonicalizes all valid URL vectors and is idempotent", () => {
    for (const v of vectors.valid) {
      const canonical = canonicalizeUrl(v.input);
      expect(canonical, v.name).toBe(v.expected);
      expect(canonicalizeUrl(canonical), `${v.name} (idempotent)`).toBe(v.expected);
    }
  });

  it("rejects all invalid URL vectors with InvalidChallengeError", () => {
    for (const bad of vectors.invalid) {
      expect(() => canonicalizeUrl(bad), `canonicalizeUrl(${bad})`).toThrow(InvalidChallengeError);
    }
  });
});

describe("@haggles/core — challenge codec and test vectors (SPEC 4.1, 4.2)", () => {
  const vectors = loadJson<{
    valid: Array<{
      name: string;
      raw?: Record<string, unknown>;
      challenge: Challenge;
      encoded?: string;
    }>;
    invalid: Array<{ name: string; payload: Record<string, unknown> }>;
    invalidEncoded: string[];
  }>("challenges.json");

  it("exposes normative header constants and protocol version", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(HEADERS).toEqual({
      required: "haggles-payment-required",
      payment: "haggles-payment",
      receipt: "haggles-receipt",
    });
  });

  it("encodes and decodes all valid challenge vectors", () => {
    for (const v of vectors.valid) {
      const input = (v.raw ?? v.challenge) as Challenge;
      const encoded = encodeChallenge(input);
      if (v.encoded) {
        expect(encoded, v.name).toBe(v.encoded);
      }
      const decoded = decodeChallenge(encoded);
      expect(decoded, v.name).toEqual(v.challenge);
    }
  });

  it("rejects all invalid challenge payloads and headers with InvalidChallengeError", () => {
    for (const inv of vectors.invalid) {
      expect(() => ChallengeSchema.parse(inv.payload), inv.name).toThrow();
      expect(() => encodeChallenge(inv.payload as unknown as Challenge), inv.name).toThrow(
        InvalidChallengeError,
      );
    }
    for (const badHeader of vectors.invalidEncoded) {
      expect(() => decodeChallenge(badHeader)).toThrow(InvalidChallengeError);
    }
  });
});

describe("@haggles/core — JWS token and receipt test vectors (SPEC 4.4, 4.5)", () => {
  const vectors = loadJson<{
    publicJwk: JsonWebKeyInput["key"] & { kid: string; alg: string };
    paymentToken: {
      header: { alg: string; typ: string; kid: string };
      claims: unknown;
      jws: string;
    };
    receipt: {
      header: { alg: string; typ: string; kid: string };
      claims: unknown;
      jws: string;
    };
  }>("tokens.json");

  it("verifies the Ed25519 signature and claims of the sample payment token and receipt", () => {
    const publicKey = createPublicKey({ key: vectors.publicJwk, format: "jwk" });

    // Verify Payment Token JWS
    const [tokHeaderB64, tokPayloadB64, tokSigB64] = vectors.paymentToken.jws.split(".");
    expect(tokHeaderB64 && tokPayloadB64 && tokSigB64).toBeTruthy();
    const tokVerified = verify(
      null,
      Buffer.from(`${tokHeaderB64}.${tokPayloadB64}`, "utf8"),
      publicKey,
      Buffer.from(tokSigB64!, "base64url"),
    );
    expect(tokVerified).toBe(true);

    const tokHeader = JSON.parse(Buffer.from(tokHeaderB64!, "base64url").toString("utf8")) as {
      typ: string;
      alg: string;
    };
    expect(tokHeader.typ).toBe(PAYMENT_TOKEN_TYP);
    expect(tokHeader.alg).toBe("EdDSA");

    const tokClaims = PaymentTokenClaimsSchema.parse(
      JSON.parse(Buffer.from(tokPayloadB64!, "base64url").toString("utf8")),
    );
    expect(tokClaims).toEqual(vectors.paymentToken.claims);

    // Verify Receipt JWS
    const [rcpHeaderB64, rcpPayloadB64, rcpSigB64] = vectors.receipt.jws.split(".");
    expect(rcpHeaderB64 && rcpPayloadB64 && rcpSigB64).toBeTruthy();
    const rcpVerified = verify(
      null,
      Buffer.from(`${rcpHeaderB64}.${rcpPayloadB64}`, "utf8"),
      publicKey,
      Buffer.from(rcpSigB64!, "base64url"),
    );
    expect(rcpVerified).toBe(true);

    const rcpHeader = JSON.parse(Buffer.from(rcpHeaderB64!, "base64url").toString("utf8")) as {
      typ: string;
      alg: string;
    };
    expect(rcpHeader.typ).toBe(RECEIPT_TYP);
    expect(rcpHeader.alg).toBe("EdDSA");

    const rcpClaims = ReceiptClaimsSchema.parse(
      JSON.parse(Buffer.from(rcpPayloadB64!, "base64url").toString("utf8")),
    );
    expect(rcpClaims).toEqual(vectors.receipt.claims);
  });
});

describe("@haggles/core — ULIDs and error catalogue", () => {
  it("generates valid prefixed ULIDs that sort lexicographically by timestamp", () => {
    const idEarly = createId("pay", 1_700_000_000_000);
    const idLate = createId("pay", 1_700_000_001_000);
    expect(isValidId(idEarly, "pay")).toBe(true);
    expect(isValidId(idEarly, "slr")).toBe(false);
    expect(idEarly < idLate).toBe(true);
    expect(() => generateUlid(-1)).toThrow(RangeError);
  });

  it("maps RFC 9457 ProblemDetails into typed HagglesError subclasses", () => {
    const codes = Object.keys(ERROR_CATALOGUE) as HagglesErrorCode[];
    for (const code of codes) {
      const entry = ERROR_CATALOGUE[code];
      const err = fromProblemDetails({
        type: `https://docs.haggles.example.com/errors/${code}`,
        title: entry.title,
        status: entry.status,
        code,
        detail: `Detail for ${code}`,
        request_id: "req_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
      });
      expect(err).toBeInstanceOf(HagglesError);
      expect(err.code).toBe(code);
      expect(err.status).toBe(entry.status);
      expect(err.requestId).toBe("req_01J9Z3K4M5N6P7Q8R9S0T1U2V3");
    }

    expect(
      fromProblemDetails({
        type: "t",
        title: "t",
        status: 422,
        code: "invalid_money",
        detail: "d",
      }),
    ).toBeInstanceOf(InvalidMoneyError);
    expect(
      fromProblemDetails({
        type: "t",
        title: "t",
        status: 422,
        code: "challenge_mismatch",
        detail: "d",
      }),
    ).toBeInstanceOf(ChallengeMismatchError);
    expect(
      fromProblemDetails({
        type: "t",
        title: "t",
        status: 403,
        code: "policy_violation",
        detail: "d",
      }),
    ).toBeInstanceOf(PolicyViolationError);
    expect(
      fromProblemDetails({
        type: "t",
        title: "t",
        status: 409,
        code: "insufficient_funds",
        detail: "d",
      }),
    ).toBeInstanceOf(InsufficientFundsError);
    expect(
      fromProblemDetails({
        type: "t",
        title: "t",
        status: 402,
        code: "payment_not_accepted",
        detail: "d",
      }),
    ).toBeInstanceOf(PaymentNotAcceptedError);
    expect(
      fromProblemDetails({
        type: "t",
        title: "t",
        status: 400,
        code: "non_replayable_body",
        detail: "d",
      }),
    ).toBeInstanceOf(NonReplayableBodyError);
    expect(
      fromProblemDetails({
        type: "t",
        title: "t",
        status: 503,
        code: "facilitator_unavailable",
        detail: "d",
      }),
    ).toBeInstanceOf(FacilitatorUnavailableError);
  });
});
