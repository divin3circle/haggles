/**
 * Canonical URL normalization for the Haggles protocol (SPEC.md section 4.3).
 */

import { InvalidChallengeError } from "./errors.js";

/**
 * Normalizes percent-encoded triplets (`%xx`) in a URL component to uppercase hexadecimal
 * without decoding reserved or unreserved characters (SPEC.md section 4.3 rule 4).
 */
function uppercasePercentEncoding(value: string): string {
  return value.replace(/%[0-9a-fA-F]{2}/g, (match) => match.toUpperCase());
}

/**
 * Normalizes an HTTP or HTTPS URL to its canonical Haggles representation (SPEC.md section 4.3):
 *
 * 1. Parse with the WHATWG `URL` parser.
 * 2. Lowercase scheme and host; strip default ports (`80` for `http`, `443` for `https`).
 * 3. Remove the fragment (`#...`).
 * 4. Normalize percent-encoding to uppercase hex; do not decode reserved characters.
 * 5. Keep path and query string exactly as received (no sorting).
 *
 * @param input - Absolute `http:` or `https:` URL string
 * @returns Canonicalized URL string
 * @throws {InvalidChallengeError} If `input` is not a valid `http:` or `https:` URL or includes credentials
 *
 * @example
 * ```ts
 * canonicalizeUrl("HTTPS://Poems.Example.COM:443/poems/%2f42?b=2&a=1#top");
 * // "https://poems.example.com/poems/%2F42?b=2&a=1"
 * ```
 */
export function canonicalizeUrl(input: string): string {
  if (typeof input !== "string" || input.trim() === "" || /^\s|\s$/.test(input)) {
    throw new InvalidChallengeError(`Invalid URL "${String(input)}": must be a trimmed URL string.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch (cause) {
    throw new InvalidChallengeError(`Invalid URL "${input}".`, { cause });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidChallengeError(
      `Unsupported URL scheme "${parsed.protocol}" in "${input}": only http: and https: are allowed.`,
    );
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new InvalidChallengeError(`URL "${input}" must not contain userinfo credentials.`);
  }

  const pathname = uppercasePercentEncoding(parsed.pathname);

  // Extract the raw query string from the original input (before any '#') if present so that
  // exact query preservation (including empty `?` vs absent `?`) is deterministic while still
  // normalizing percent-encoding to uppercase hex.
  const hashIdx = input.indexOf("#");
  const withoutHash = hashIdx === -1 ? input : input.slice(0, hashIdx);
  const queryIdx = withoutHash.indexOf("?");
  let search = "";
  if (queryIdx !== -1) {
    const rawQuery = withoutHash.slice(queryIdx + 1);
    if (rawQuery.length > 0) {
      // Use WHATWG URL's percent-encoding of spaces/non-ASCII in `parsed.search`, then uppercase hex.
      search = uppercasePercentEncoding(parsed.search);
    }
  }

  return `${parsed.protocol}//${parsed.host}${pathname}${search}`;
}
