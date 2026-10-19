/**
 * JWS claims and schemas for Haggles payment tokens and receipts (SPEC.md sections 4.4, 4.5, 10.1).
 */

import { z } from "zod";
import { MONEY_STRING_REGEX } from "./money.js";

/**
 * JWS `typ` header parameter for a Haggles payment token (SPEC.md section 4.4).
 *
 * @example
 * ```ts
 * console.log(PAYMENT_TOKEN_TYP); // "haggles-payment+jwt"
 * ```
 */
export const PAYMENT_TOKEN_TYP = "haggles-payment+jwt" as const;

/**
 * JWS `typ` header parameter for a Haggles payment receipt (SPEC.md section 4.5).
 *
 * @example
 * ```ts
 * console.log(RECEIPT_TYP); // "haggles-receipt+jwt"
 * ```
 */
export const RECEIPT_TYP = "haggles-receipt+jwt" as const;

/**
 * Claims carried inside an EdDSA-signed Haggles payment token (`Haggles-Payment`, SPEC.md section 4.4).
 *
 * MUST NOT contain buyer identity (no account, wallet, or agent key IDs).
 *
 * @example
 * ```ts
 * const claims: PaymentTokenClaims = {
 *   iss: "https://api.haggles.example.com",
 *   aud: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
 *   sub: "pay_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
 *   iat: 1791288000,
 *   exp: 1791288060,
 *   amount: "0.02",
 *   currency: "USD",
 *   method: "GET",
 *   url: "https://poems.example.com/poems/42",
 *   chl: "chl_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
 * };
 * ```
 */
export interface PaymentTokenClaims {
  /** Facilitator base URL */
  iss: string;
  /** Seller ID (`slr_...`) — only that seller may redeem it */
  aud: string;
  /** Payment ID (`pay_...`) */
  sub: string;
  /** Issued-at timestamp (UNIX seconds) */
  iat: number;
  /** Expiration timestamp (UNIX seconds, `iat + 60`) */
  exp: number;
  /** Authorized decimal USD amount (e.g. `"0.02"`) */
  amount: string;
  /** Currency code (`"USD"`) */
  currency: "USD";
  /** HTTP method the token is valid for */
  method: string;
  /** Canonical request URL the token is valid for */
  url: string;
  /** Challenge ID (`chl_...`) */
  chl: string;
}

/**
 * Zod schema validating {@link PaymentTokenClaims} (SPEC.md section 4.4).
 *
 * @example
 * ```ts
 * const claims = PaymentTokenClaimsSchema.parse(decodedPayload);
 * ```
 */
export const PaymentTokenClaimsSchema: z.ZodType<PaymentTokenClaims> = z
  .object({
    iss: z.string().min(1),
    aud: z.string().regex(/^slr_[0-9A-Za-z]{10,64}$/),
    sub: z.string().regex(/^pay_[0-9A-Za-z]{10,64}$/),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
    amount: z.string().regex(MONEY_STRING_REGEX),
    currency: z.literal("USD"),
    method: z.string().regex(/^[A-Z]+$/),
    url: z.string().min(1),
    chl: z.string().regex(/^chl_[0-9A-Za-z]{10,64}$/),
  })
  .strip();

/**
 * Claims carried inside an EdDSA-signed Haggles payment receipt (`Haggles-Receipt`, SPEC.md section 4.5).
 *
 * @example
 * ```ts
 * const receipt: ReceiptClaims = {
 *   iss: "https://api.haggles.example.com",
 *   sub: "pay_01J9Z3K4M5N6P7Q8R9S0T1U2V3",
 *   aud: "slr_01J9Y8K4M5N6P7Q8R9S0T1U2V3",
 *   iat: 1791288001,
 *   amount: "0.02",
 *   currency: "USD",
 *   method: "GET",
 *   url: "https://poems.example.com/poems/42",
 *   captured_at: "2026-10-06T12:00:01Z",
 * };
 * ```
 */
export interface ReceiptClaims {
  /** Facilitator base URL */
  iss: string;
  /** Payment ID (`pay_...`) */
  sub: string;
  /** Seller ID (`slr_...`) */
  aud: string;
  /** Issued-at timestamp (UNIX seconds) */
  iat: number;
  /** Captured decimal USD amount (e.g. `"0.02"`) */
  amount: string;
  /** Currency code (`"USD"`) */
  currency: "USD";
  /** HTTP method of the paid request */
  method: string;
  /** Canonical URL of the paid request */
  url: string;
  /** ISO 8601 UTC timestamp when the payment was captured */
  captured_at: string;
}

/**
 * Zod schema validating {@link ReceiptClaims} (SPEC.md section 4.5).
 *
 * @example
 * ```ts
 * const receiptClaims = ReceiptClaimsSchema.parse(decodedPayload);
 * ```
 */
export const ReceiptClaimsSchema: z.ZodType<ReceiptClaims> = z
  .object({
    iss: z.string().min(1),
    sub: z.string().regex(/^pay_[0-9A-Za-z]{10,64}$/),
    aud: z.string().regex(/^slr_[0-9A-Za-z]{10,64}$/),
    iat: z.number().int().nonnegative(),
    amount: z.string().regex(MONEY_STRING_REGEX),
    currency: z.literal("USD"),
    method: z.string().regex(/^[A-Z]+$/),
    url: z.string().min(1),
    captured_at: z.string().min(1),
  })
  .strip();
