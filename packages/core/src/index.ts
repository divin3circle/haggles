/**
 * `@haggles/core` — Normative Haggles wire protocol primitives, money math, canonical URLs,
 * challenge codec, JWS claim schemas, prefixed ULIDs, and error types (SPEC.md sections 4 and 10.1).
 */

export {
  ChallengeMismatchError,
  ERROR_CATALOGUE,
  type ErrorCatalogueEntry,
  FacilitatorUnavailableError,
  fromProblemDetails,
  HagglesError,
  type HagglesErrorCode,
  type HagglesErrorOptions,
  InsufficientFundsError,
  InvalidChallengeError,
  InvalidMoneyError,
  NonReplayableBodyError,
  PaymentNotAcceptedError,
  PolicyViolationError,
  type ProblemDetails,
} from "./errors.js";

export {
  computePlatformFeeMicros,
  DEFAULT_PRICE_MAX_MICROS,
  DEFAULT_PRICE_MIN_MICROS,
  floorToCentsMicros,
  formatMoney,
  MAX_WIRE_MONEY_MICROS,
  MICROS_PER_USD,
  MONEY_STRING_REGEX,
  parseMoney,
} from "./money.js";

export { canonicalizeUrl } from "./url.js";

export {
  type Challenge,
  ChallengeSchema,
  decodeChallenge,
  encodeChallenge,
  HEADERS,
  PROTOCOL_VERSION,
} from "./challenge.js";

export {
  PAYMENT_TOKEN_TYP,
  type PaymentTokenClaims,
  PaymentTokenClaimsSchema,
  RECEIPT_TYP,
  type ReceiptClaims,
  ReceiptClaimsSchema,
} from "./claims.js";

export {
  createId,
  generateUlid,
  type IdPrefix,
  isValidId,
  type PrefixedId,
} from "./ids.js";
