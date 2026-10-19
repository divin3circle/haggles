/**
 * Prefixed, sortable ULID identifiers for Haggles entities (SPEC.md section 0.1).
 */

import { randomBytes } from "node:crypto";

/**
 * Valid entity ID prefixes defined in SPEC.md sections 0.1, 4.11, and 7.2.
 *
 * @example
 * ```ts
 * const prefix: IdPrefix = "pay";
 * ```
 */
export type IdPrefix =
  | "acc"
  | "wal"
  | "agk"
  | "slr"
  | "slk"
  | "ep"
  | "pay"
  | "top"
  | "pot"
  | "ltx"
  | "chl"
  | "req"
  | "hgb";

/**
 * Template literal type for a prefixed Haggles ID (`<prefix>_<ULID>`).
 *
 * @example
 * ```ts
 * const id: PrefixedId<"pay"> = createId("pay");
 * ```
 */
export type PrefixedId<P extends IdPrefix = IdPrefix> = `${P}_${string}`;

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * Generates a 26-character Crockford Base32 ULID string using `node:crypto` CSPRNG.
 *
 * @param timestampMs - Optional UNIX timestamp in milliseconds (defaults to `Date.now()`)
 * @returns 26-character uppercase ULID string
 *
 * @example
 * ```ts
 * const ulid = generateUlid(); // e.g. "01J9Z3K4M5N6P7Q8R9S0T1U2V3"
 * ```
 */
export function generateUlid(timestampMs: number = Date.now()): string {
  if (!Number.isInteger(timestampMs) || timestampMs < 0 || timestampMs > 0xffffffffffff) {
    throw new RangeError(`Invalid ULID timestamp: ${String(timestampMs)}`);
  }

  let time = BigInt(timestampMs);
  const timeChars = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    timeChars[i] = CROCKFORD_BASE32[Number(time & 31n)]!;
    time >>= 5n;
  }

  const rand = randomBytes(10);
  let randBits = 0n;
  for (const byte of rand) {
    randBits = (randBits << 8n) | BigInt(byte);
  }
  const randChars = new Array<string>(16);
  for (let i = 15; i >= 0; i--) {
    randChars[i] = CROCKFORD_BASE32[Number(randBits & 31n)]!;
    randBits >>= 5n;
  }

  return timeChars.join("") + randChars.join("");
}

/**
 * Generates a prefixed, sortable Haggles entity ID (`<prefix>_<ULID>`, SPEC.md section 0.1).
 *
 * @param prefix - Entity prefix (e.g. `"chl"`, `"pay"`, `"slr"`)
 * @param timestampMs - Optional UNIX timestamp in milliseconds for deterministic tests
 * @returns Prefixed ULID string
 *
 * @example
 * ```ts
 * const challengeId = createId("chl"); // "chl_01J9Z3..."
 * ```
 */
export function createId<P extends IdPrefix>(prefix: P, timestampMs?: number): PrefixedId<P> {
  return `${prefix}_${generateUlid(timestampMs)}`;
}

/**
 * Checks whether a string is a syntactically valid prefixed ULID for the given prefix.
 *
 * @param value - Candidate ID string
 * @param prefix - Expected entity prefix
 * @returns `true` if `value` matches `<prefix>_<26-char Crockford ULID>`
 *
 * @example
 * ```ts
 * isValidId("chl_01J9Z3K4M5N6P7Q8R9S0T1U2V3", "chl"); // true
 * ```
 */
export function isValidId<P extends IdPrefix>(value: string, prefix: P): value is PrefixedId<P> {
  if (typeof value !== "string") return false;
  const expectedPrefix = `${prefix}_`;
  if (!value.startsWith(expectedPrefix)) return false;
  return ULID_REGEX.test(value.slice(expectedPrefix.length));
}
