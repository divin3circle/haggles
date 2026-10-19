/**
 * Haggles HTTP 402 challenge schema, headers, and base64url codec (SPEC.md sections 4.1, 4.2, 10.1).
 */

import { z } from "zod";
import { InvalidChallengeError } from "./errors.js";
import {
  DEFAULT_PRICE_MAX_MICROS,
  DEFAULT_PRICE_MIN_MICROS,
  MONEY_STRING_REGEX,
  parseMoney,
} from "./money.js";
import { canonicalizeUrl } from "./url.js";

/**
 * Current wire protocol version (SPEC.md sections 4.2 and 10.1).
 *
 * @example
 * ```ts
 * console.log(PROTOCOL_VERSION); // 1
 * ```
 */
export const PROTOCOL_VERSION = 1 as const;

/**
 * Lowercase HTTP header names used by the Haggles protocol (SPEC.md sections 4.1 and 10.1).
 *
 * @example
 * ```ts
 * const rawChallenge = response.headers.get(HEADERS.required);
 * ```
 */
export const HEADERS = {
  required: "haggles-payment-required",
  payment: "haggles-payment",
  receipt: "haggles-receipt",
} as const;

/**
 * HTTP `402 Payment Required` challenge payload issued by a seller server (SPEC.md sections 4.2 and 10.1).
 *
 * @example
 * ```ts
 * const challenge: Challenge = {
 *   protocol: "haggles",
 *   version: 1,
 *   scheme: "prepaid-usd",
 *   challenge_id: "chl_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
 *   amount: "0.02",
 *   currency: "USD",
 *   method: "GET",
 *   url: "https://poems.example.com/poems/42",
 *   seller_id: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
 *   description: "One poem from the collection",
 *   facilitator: "https://api.haggles.example.com",
 *   expires_at: "2026-10-06T12:01:00Z",
 * };
 * ```
 */
export interface Challenge {
  protocol: "haggles";
  version: 1;
  scheme: "prepaid-usd";
  challenge_id: string;
  amount: string;
  currency: "USD";
  method: string;
  url: string;
  seller_id: string;
  description?: string | undefined;
  facilitator: string;
  expires_at: string;
}

const ISO_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

function isValidHttpUrl(value: string): boolean {
  try {
    canonicalizeUrl(value);
    return true;
  } catch {
    return false;
  }
}

function isValidIsoTimestamp(value: string): boolean {
  if (!ISO_UTC_TIMESTAMP_REGEX.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms);
}

/**
 * Zod schema validating a Haggles HTTP `402` {@link Challenge} (SPEC.md sections 4.2 and 10.1).
 *
 * Unknown fields are stripped per SPEC.md section 4.2 ("Unknown fields MUST be ignored by clients").
 *
 * @example
 * ```ts
 * const parsed = ChallengeSchema.parse(rawJson);
 * ```
 */
export const ChallengeSchema: z.ZodType<Challenge> = z
  .object({
    protocol: z.literal("haggles"),
    version: z.literal(PROTOCOL_VERSION),
    scheme: z.literal("prepaid-usd"),
    challenge_id: z
      .string()
      .regex(/^chl_[0-9A-Za-z]{10,64}$/, "challenge_id must start with chl_"),
    amount: z
      .string()
      .regex(MONEY_STRING_REGEX, "amount must be a valid decimal USD string")
      .refine((val) => {
        try {
          const micros = parseMoney(val);
          return micros >= DEFAULT_PRICE_MIN_MICROS && micros <= DEFAULT_PRICE_MAX_MICROS;
        } catch {
          return false;
        }
      }, "amount must be between 0.0001 and 5.00 USD"),
    currency: z.literal("USD"),
    method: z.string().regex(/^[A-Z]+$/, "method must be an uppercase HTTP method"),
    url: z.string().refine(isValidHttpUrl, "url must be a valid http(s) URL"),
    seller_id: z.string().regex(/^slr_[0-9A-Za-z]{10,64}$/, "seller_id must start with slr_"),
    description: z.string().max(500).optional(),
    facilitator: z.string().refine(isValidHttpUrl, "facilitator must be a valid http(s) URL"),
    expires_at: z
      .string()
      .refine(isValidIsoTimestamp, "expires_at must be an ISO 8601 UTC timestamp"),
  })
  .strip();

/**
 * Encodes a validated {@link Challenge} as an unpadded `base64url(UTF-8 JSON)` string
 * suitable for the `Haggles-Payment-Required` header (SPEC.md sections 4.1 and 10.1).
 *
 * @param c - Challenge object to encode
 * @returns `base64url`-encoded UTF-8 JSON representation
 * @throws {InvalidChallengeError} If `c` fails {@link ChallengeSchema} validation
 *
 * @example
 * ```ts
 * const headerValue = encodeChallenge(challenge);
 * ```
 */
export function encodeChallenge(c: Challenge): string {
  const result = ChallengeSchema.safeParse(c);
  if (!result.success) {
    throw new InvalidChallengeError(`Invalid challenge: ${result.error.message}`, {
      cause: result.error,
    });
  }
  const json = JSON.stringify(result.data);
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decodes and validates a `base64url(UTF-8 JSON)` `Haggles-Payment-Required` header value
 * into a typed {@link Challenge} (SPEC.md sections 4.1, 4.2, and 10.1).
 *
 * @param h - Raw `Haggles-Payment-Required` header string
 * @returns Validated {@link Challenge} object (with unknown properties stripped)
 * @throws {InvalidChallengeError} If `h` is not valid base64url, valid UTF-8 JSON, or fails {@link ChallengeSchema}
 *
 * @example
 * ```ts
 * const challenge = decodeChallenge(headerValue);
 * console.log(challenge.amount); // "0.02"
 * ```
 */
export function decodeChallenge(h: string): Challenge {
  if (typeof h !== "string" || h.length === 0 || !BASE64URL_REGEX.test(h)) {
    throw new InvalidChallengeError(
      "Malformed Haggles-Payment-Required header: expected non-empty base64url string.",
    );
  }
  let parsedJson: unknown;
  try {
    const decoded = Buffer.from(h, "base64url").toString("utf8");
    parsedJson = JSON.parse(decoded);
  } catch (cause) {
    throw new InvalidChallengeError("Malformed Haggles-Payment-Required header JSON.", { cause });
  }
  const result = ChallengeSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new InvalidChallengeError(`Invalid challenge payload: ${result.error.message}`, {
      cause: result.error,
    });
  }
  return result.data;
}
