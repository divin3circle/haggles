/**
 * Fixed-point USD money conversion utilities using integer micro-dollars (`bigint`).
 *
 * Implements SPEC.md sections 0.1, 2.3, 4.2, and 10.1.
 * Floating-point numbers MUST NOT be used for money anywhere.
 */

import { InvalidMoneyError } from "./errors.js";

/**
 * Number of micro-dollars in 1.00 USD (`1_000_000n`).
 *
 * @example
 * ```ts
 * const twoDollars = 2n * MICROS_PER_USD; // 2_000_000n
 * ```
 */
export const MICROS_PER_USD = 1_000_000n;

/**
 * Default minimum price per call in micro-dollars (`0.0001` USD = `100n` micros, SPEC.md section 2.3).
 *
 * @example
 * ```ts
 * console.log(DEFAULT_PRICE_MIN_MICROS); // 100n
 * ```
 */
export const DEFAULT_PRICE_MIN_MICROS = 100n;

/**
 * Default maximum price per call in micro-dollars (`5.00` USD = `5_000_000n` micros, SPEC.md section 2.3).
 *
 * @example
 * ```ts
 * console.log(DEFAULT_PRICE_MAX_MICROS); // 5000000n
 * ```
 */
export const DEFAULT_PRICE_MAX_MICROS = 5_000_000n;

/**
 * Maximum integer micro-dollar value representable by the wire regex `^\d{1,7}(\.\d{1,6})?$` (`9999999.999999` USD).
 *
 * @example
 * ```ts
 * console.log(MAX_WIRE_MONEY_MICROS); // 9999999999999n
 * ```
 */
export const MAX_WIRE_MONEY_MICROS = 9_999_999_999_999n;

/**
 * Regular expression matching valid wire-format USD decimal strings (SPEC.md section 4.2).
 * Rejects leading zeros on multi-digit whole numbers (e.g. `"00.02"` is rejected, `"0.02"` is accepted).
 *
 * @example
 * ```ts
 * MONEY_STRING_REGEX.test("0.02"); // true
 * MONEY_STRING_REGEX.test("1e-5"); // false
 * ```
 */
export const MONEY_STRING_REGEX = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/;

/**
 * Parses a decimal USD wire string (e.g. `"0.02"`) into an integer count of micro-dollars (`bigint`).
 *
 * Floating point is never used. Strings must match `^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$`.
 * Throws {@link InvalidMoneyError} on malformed input.
 *
 * @param s - Decimal USD amount string (1 to 7 integer digits, optional 1 to 6 fractional digits)
 * @returns Micro-dollar count as a `bigint` (`1 USD = 1_000_000n`)
 * @throws {InvalidMoneyError} If `s` is not a valid non-negative USD decimal string
 *
 * @example
 * ```ts
 * parseMoney("0.02");     // 20000n
 * parseMoney("0.0001");   // 100n
 * parseMoney("12.50");    // 12500000n
 * ```
 */
export function parseMoney(s: string): bigint {
  if (typeof s !== "string" || !MONEY_STRING_REGEX.test(s)) {
    throw new InvalidMoneyError(
      `Invalid USD amount "${String(s)}": must be a non-negative decimal string with up to 7 integer digits and 1-6 decimal places.`,
    );
  }
  const dotIndex = s.indexOf(".");
  if (dotIndex === -1) {
    return BigInt(s) * MICROS_PER_USD;
  }
  const wholePart = s.slice(0, dotIndex);
  const fracPart = s.slice(dotIndex + 1).padEnd(6, "0");
  return BigInt(wholePart) * MICROS_PER_USD + BigInt(fracPart);
}

/**
 * Formats an integer count of micro-dollars (`bigint`) into a canonical decimal USD wire string.
 *
 * Always emits at least 2 decimal places and at most 6 decimal places, trimming trailing zeros
 * past the second decimal place (SPEC.md section 10.1).
 *
 * @param micros - Non-negative micro-dollar amount (`bigint`)
 * @returns Canonical decimal USD string (e.g. `"0.02"`, `"12.50"`, `"0.0035"`)
 * @throws {InvalidMoneyError} If `micros` is negative, not a `bigint`, or exceeds the 7-digit wire limit
 *
 * @example
 * ```ts
 * formatMoney(20_000n);     // "0.02"
 * formatMoney(3_500n);      // "0.0035"
 * formatMoney(12_500_000n); // "12.50"
 * ```
 */
export function formatMoney(micros: bigint): string {
  if (typeof micros !== "bigint") {
    throw new InvalidMoneyError(`Expected bigint micro-dollars, received ${typeof micros}.`);
  }
  if (micros < 0n) {
    throw new InvalidMoneyError(`Micro-dollar amount cannot be negative (${micros.toString()}).`);
  }
  if (micros > MAX_WIRE_MONEY_MICROS) {
    throw new InvalidMoneyError(
      `Micro-dollar amount ${micros.toString()} exceeds maximum wire value ${MAX_WIRE_MONEY_MICROS.toString()}.`,
    );
  }
  const whole = micros / MICROS_PER_USD;
  const remainder = micros % MICROS_PER_USD;
  const fracSix = remainder.toString().padStart(6, "0");
  const trimmed = fracSix.replace(/0+$/, "").padEnd(2, "0");
  return `${whole.toString()}.${trimmed}`;
}

/**
 * Computes the platform fee in micro-dollars for a gross payment amount:
 * `floor(grossMicros * feeBps / 10000)` (SPEC.md section 6.3).
 *
 * @param grossMicros - Payment gross amount in micro-dollars (`>= 0n`)
 * @param feeBps - Platform fee in basis points (e.g. `500` for 5%)
 * @returns Platform fee in micro-dollars (`bigint`)
 * @throws {InvalidMoneyError} If `grossMicros` is negative or `feeBps` is outside `0..10000`
 *
 * @example
 * ```ts
 * computePlatformFeeMicros(20_000n, 500); // 1000n ($0.001 fee on $0.02 at 5%)
 * ```
 */
export function computePlatformFeeMicros(grossMicros: bigint, feeBps: number): bigint {
  if (grossMicros < 0n) {
    throw new InvalidMoneyError("Gross payment amount cannot be negative.");
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new InvalidMoneyError(
      `Platform fee basis points must be an integer between 0 and 10000, got ${String(feeBps)}.`,
    );
  }
  return (grossMicros * BigInt(feeBps)) / 10_000n;
}

/**
 * Rounds a micro-dollar balance down to whole USD cents (`10_000n` micros = `$0.01`)
 * as required for PayPal payouts (SPEC.md sections 2.3 and 7.2).
 *
 * @param micros - Micro-dollar amount (`>= 0n`)
 * @returns Micro-dollar amount rounded down to a multiple of `10_000n`
 * @throws {InvalidMoneyError} If `micros` is negative
 *
 * @example
 * ```ts
 * floorToCentsMicros(1_239_500n); // 1_230_000n ($1.23)
 * ```
 */
export function floorToCentsMicros(micros: bigint): bigint {
  if (micros < 0n) {
    throw new InvalidMoneyError("Cannot floor a negative micro-dollar amount to cents.");
  }
  return (micros / 10_000n) * 10_000n;
}
