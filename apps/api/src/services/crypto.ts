/**
 * Cryptographic services for the Haggles facilitator:
 * - AES-256-GCM envelope encryption for Ed25519 signing private keys (`MASTER_KEY`, SPEC.md section 4.6, 8.1)
 * - EdDSA (Ed25519) JWS payment token and receipt signing and verification (`jose`, SPEC.md section 4.4, 4.5, 4.6)
 * - API key generation (`hgk_<env>_...`, `hgs_<env>_...`), HMAC-SHA256 hashing (`KEY_PEPPER`),
 *   constant-time verification, and pseudonymous `agent_ref` derivation (SPEC.md section 8.1, 8.4).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  createId,
  InvalidChallengeError,
  PAYMENT_TOKEN_TYP,
  type PaymentTokenClaims,
  PaymentTokenClaimsSchema,
  RECEIPT_TYP,
  type ReceiptClaims,
  ReceiptClaimsSchema,
} from "@haggles/core";
import { CompactSign, compactVerify, exportJWK, importJWK, type JWK } from "jose";

const AES_IV_BYTES = 12;
const AES_TAG_BYTES = 16;

/**
 * Encrypts a UTF-8 plaintext string using AES-256-GCM with a base64-encoded 32-byte `masterKeyB64` (SPEC.md section 4.6, 8.1).
 *
 * Output format: `v1:<base64url(iv)>:<base64url(authTag)>:<base64url(ciphertext)>`.
 *
 * @param plaintext - Secret string to encrypt (e.g. JSON-serialized private JWK)
 * @param masterKeyB64 - Base64-encoded 32-byte master key
 * @returns Authenticated ciphertext blob
 *
 * @example
 * ```ts
 * const blob = encryptWithMasterKey('{"kty":"OKP"}', masterKeyB64);
 * ```
 */
export function encryptWithMasterKey(plaintext: string, masterKeyB64: string): string {
  const key = Buffer.from(masterKeyB64, "base64");
  if (key.byteLength !== 32) {
    throw new Error("MASTER_KEY must decode to exactly 32 bytes.");
  }
  const iv = randomBytes(AES_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AES_TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

/**
 * Decrypts an AES-256-GCM blob produced by {@link encryptWithMasterKey}.
 *
 * @param blob - Encrypted blob (`v1:<iv>:<tag>:<ciphertext>`)
 * @param masterKeyB64 - Base64-encoded 32-byte master key
 * @returns Decrypted UTF-8 plaintext
 * @throws {Error} If authentication tag verification fails or the format is invalid
 *
 * @example
 * ```ts
 * const plain = decryptWithMasterKey(blob, masterKeyB64);
 * ```
 */
export function decryptWithMasterKey(blob: string, masterKeyB64: string): string {
  const key = Buffer.from(masterKeyB64, "base64");
  if (key.byteLength !== 32) {
    throw new Error("MASTER_KEY must decode to exactly 32 bytes.");
  }
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted private key blob format.");
  }
  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const ciphertext = Buffer.from(parts[3]!, "base64url");
  if (iv.byteLength !== AES_IV_BYTES || tag.byteLength !== AES_TAG_BYTES) {
    throw new Error("Invalid IV or authTag length in encrypted private key blob.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AES_TAG_BYTES });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Stored signing key record matching the `signing_keys` table (SPEC.md sections 4.6 and 6.1).
 *
 * @example
 * ```ts
 * const keyRecord = await generateSigningKeyRecord(masterKeyB64);
 * ```
 */
export interface SigningKeyRecord {
  /** Key ID (`kid_...`) */
  kid: string;
  /** Public Ed25519 JWK published in `/.well-known/jwks.json` */
  publicJwk: JWK & { kid: string; alg: "EdDSA"; use: "sig" };
  /** AES-256-GCM encrypted private JWK */
  privateEnc: string;
  /** Key lifecycle status */
  status: "active" | "retired";
  /** Creation timestamp */
  createdAt: Date;
  /** Retirement timestamp if retired */
  retiredAt: Date | null;
}

/**
 * Generates a fresh Ed25519 signing keypair and encrypts its private JWK with `masterKeyB64` (SPEC.md section 4.6).
 *
 * @param masterKeyB64 - Base64-encoded 32-byte `MASTER_KEY`
 * @param kid - Optional explicit key ID (defaults to `kid_<ULID>`)
 * @returns A ready-to-persist {@link SigningKeyRecord}
 *
 * @example
 * ```ts
 * const record = await generateSigningKeyRecord(masterKey);
 * ```
 */
export async function generateSigningKeyRecord(
  masterKeyB64: string,
  kid: string = `kid_${createId("chl").slice(4)}`,
): Promise<SigningKeyRecord> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubRaw = await exportJWK(publicKey);
  const privRaw = await exportJWK(privateKey);
  const publicJwk: SigningKeyRecord["publicJwk"] = {
    ...pubRaw,
    kid,
    alg: "EdDSA",
    use: "sig",
  };
  const privateJwk: JWK = {
    ...privRaw,
    kid,
    alg: "EdDSA",
  };
  const privateEnc = encryptWithMasterKey(JSON.stringify(privateJwk), masterKeyB64);
  return {
    kid,
    publicJwk,
    privateEnc,
    status: "active",
    createdAt: new Date(),
    retiredAt: null,
  };
}

/**
 * Signs a Haggles payment token (`typ: "haggles-payment+jwt"`, `alg: "EdDSA"`, SPEC.md section 4.4).
 *
 * @param claims - Validated {@link PaymentTokenClaims}
 * @param signingKey - Active facilitator {@link SigningKeyRecord}
 * @param masterKeyB64 - Base64-encoded 32-byte `MASTER_KEY`
 * @returns Compact JWS string
 *
 * @example
 * ```ts
 * const token = await signPaymentToken(claims, activeKey, masterKey);
 * ```
 */
export async function signPaymentToken(
  claims: PaymentTokenClaims,
  signingKey: SigningKeyRecord,
  masterKeyB64: string,
): Promise<string> {
  const validated = PaymentTokenClaimsSchema.parse(claims);
  const privateJwk = JSON.parse(
    decryptWithMasterKey(signingKey.privateEnc, masterKeyB64),
  ) as JWK;
  const keyLike = await importJWK(privateJwk, "EdDSA");
  const payloadBytes = new TextEncoder().encode(JSON.stringify(validated));
  return new CompactSign(payloadBytes)
    .setProtectedHeader({
      alg: "EdDSA",
      typ: PAYMENT_TOKEN_TYP,
      kid: signingKey.kid,
    })
    .sign(keyLike);
}

/**
 * Signs a Haggles payment receipt (`typ: "haggles-receipt+jwt"`, `alg: "EdDSA"`, SPEC.md section 4.5).
 *
 * @param claims - Validated {@link ReceiptClaims}
 * @param signingKey - Active facilitator {@link SigningKeyRecord}
 * @param masterKeyB64 - Base64-encoded 32-byte `MASTER_KEY`
 * @returns Compact JWS string
 *
 * @example
 * ```ts
 * const receipt = await signReceipt(receiptClaims, activeKey, masterKey);
 * ```
 */
export async function signReceipt(
  claims: ReceiptClaims,
  signingKey: SigningKeyRecord,
  masterKeyB64: string,
): Promise<string> {
  const validated = ReceiptClaimsSchema.parse(claims);
  const privateJwk = JSON.parse(
    decryptWithMasterKey(signingKey.privateEnc, masterKeyB64),
  ) as JWK;
  const keyLike = await importJWK(privateJwk, "EdDSA");
  const payloadBytes = new TextEncoder().encode(JSON.stringify(validated));
  return new CompactSign(payloadBytes)
    .setProtectedHeader({
      alg: "EdDSA",
      typ: RECEIPT_TYP,
      kid: signingKey.kid,
    })
    .sign(keyLike);
}

/**
 * Verifies a compact JWS payment token against a set of published public JWKs (SPEC.md section 4.4, 4.10).
 *
 * Note: Does not check `exp` against wall-clock time so callers can distinguish signature/format errors
 * from `token_expired` (410) at redemption time.
 *
 * @param token - Compact JWS string
 * @param publicJwks - Published facilitator public JWKs
 * @returns Verified header (`kid`) and {@link PaymentTokenClaims}
 * @throws {InvalidChallengeError} If the JWS header, signature, or claims are invalid
 *
 * @example
 * ```ts
 * const { claims } = await verifyPaymentTokenJws(token, [record.publicJwk]);
 * ```
 */
export async function verifyPaymentTokenJws(
  token: string,
  publicJwks: ReadonlyArray<JWK & { kid: string }>,
): Promise<{ kid: string; claims: PaymentTokenClaims }> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0]) {
    throw new InvalidChallengeError("Malformed JWS payment token.");
  }
  let header: { alg?: unknown; typ?: unknown; kid?: unknown };
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
      alg?: unknown;
      typ?: unknown;
      kid?: unknown;
    };
  } catch (cause) {
    throw new InvalidChallengeError("Malformed JWS protected header.", { cause });
  }
  if (header.alg !== "EdDSA" || header.typ !== PAYMENT_TOKEN_TYP || typeof header.kid !== "string") {
    throw new InvalidChallengeError("Invalid JWS payment token header (expected alg=EdDSA, typ=haggles-payment+jwt).");
  }
  const jwk = publicJwks.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new InvalidChallengeError(`Unknown signing key ID "${header.kid}".`);
  }
  try {
    const keyLike = await importJWK(jwk, "EdDSA");
    const { payload } = await compactVerify(token, keyLike);
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    const claims = PaymentTokenClaimsSchema.parse(parsed);
    return { kid: header.kid, claims };
  } catch (cause) {
    throw new InvalidChallengeError("Payment token signature or claims verification failed.", {
      cause,
    });
  }
}

/**
 * Verifies a compact JWS receipt against a set of published public JWKs (SPEC.md section 4.5).
 *
 * @param receipt - Compact JWS receipt string
 * @param publicJwks - Published facilitator public JWKs
 * @returns Verified header (`kid`) and {@link ReceiptClaims}
 * @throws {InvalidChallengeError} If signature or claims verification fails
 *
 * @example
 * ```ts
 * const { claims } = await verifyReceiptJws(receipt, [record.publicJwk]);
 * ```
 */
export async function verifyReceiptJws(
  receipt: string,
  publicJwks: ReadonlyArray<JWK & { kid: string }>,
): Promise<{ kid: string; claims: ReceiptClaims }> {
  const parts = receipt.split(".");
  if (parts.length !== 3 || !parts[0]) {
    throw new InvalidChallengeError("Malformed JWS receipt.");
  }
  let header: { alg?: unknown; typ?: unknown; kid?: unknown };
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
      alg?: unknown;
      typ?: unknown;
      kid?: unknown;
    };
  } catch (cause) {
    throw new InvalidChallengeError("Malformed JWS receipt header.", { cause });
  }
  if (header.alg !== "EdDSA" || header.typ !== RECEIPT_TYP || typeof header.kid !== "string") {
    throw new InvalidChallengeError("Invalid JWS receipt header (expected alg=EdDSA, typ=haggles-receipt+jwt).");
  }
  const jwk = publicJwks.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new InvalidChallengeError(`Unknown signing key ID "${header.kid}".`);
  }
  try {
    const keyLike = await importJWK(jwk, "EdDSA");
    const { payload } = await compactVerify(receipt, keyLike);
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    const claims = ReceiptClaimsSchema.parse(parsed);
    return { kid: header.kid, claims };
  } catch (cause) {
    throw new InvalidChallengeError("Receipt signature or claims verification failed.", {
      cause,
    });
  }
}

/**
 * Generated API key material (SPEC.md section 8.1).
 *
 * @example
 * ```ts
 * const generated = generateApiKey("hgk", "test", pepperB64);
 * ```
 */
export interface GeneratedApiKey {
  /** Full secret API key shown once at creation (`hgk_<env>_<43 base64url chars>`) */
  fullKey: string;
  /** First 16 characters stored in the `prefix` column for indexed lookup */
  prefix: string;
  /** Hex-encoded `HMAC-SHA256(KEY_PEPPER, fullKey)` stored in `key_hash` */
  keyHash: string;
}

/**
 * Generates an agent (`hgk`) or seller (`hgs`) API key with 32 random bytes (43 base64url chars)
 * and computes its `prefix` (first 16 chars) and `HMAC-SHA256` hash (SPEC.md section 8.1).
 *
 * @param kind - `"hgk"` for agent keys or `"hgs"` for seller keys
 * @param env - `"test"` or `"live"`
 * @param keyPepperB64 - Base64-encoded 32-byte `KEY_PEPPER`
 * @returns {@link GeneratedApiKey}
 *
 * @example
 * ```ts
 * const { fullKey, prefix, keyHash } = generateApiKey("hgk", "test", pepperB64);
 * ```
 */
export function generateApiKey(
  kind: "hgk" | "hgs",
  env: "test" | "live",
  keyPepperB64: string,
): GeneratedApiKey {
  const randomPart = randomBytes(32).toString("base64url"); // 43 chars
  const fullKey = `${kind}_${env}_${randomPart}`;
  const prefix = fullKey.slice(0, 16);
  const keyHash = hashApiKey(fullKey, keyPepperB64);
  return { fullKey, prefix, keyHash };
}

/**
 * Computes `HMAC-SHA256(KEY_PEPPER, fullKey)` as a 64-character lowercase hex string (SPEC.md section 8.1).
 *
 * @param fullKey - Full API key string
 * @param keyPepperB64 - Base64-encoded 32-byte `KEY_PEPPER`
 * @returns 64-char hex HMAC digest
 *
 * @example
 * ```ts
 * const digest = hashApiKey(fullKey, pepperB64);
 * ```
 */
export function hashApiKey(fullKey: string, keyPepperB64: string): string {
  const pepper = Buffer.from(keyPepperB64, "base64");
  if (pepper.byteLength !== 32) {
    throw new Error("KEY_PEPPER must decode to exactly 32 bytes.");
  }
  return createHmac("sha256", pepper).update(fullKey, "utf8").digest("hex");
}

/**
 * Verifies a candidate API key against a stored hex `keyHash` in constant time using `timingSafeEqual` (SPEC.md section 8.1).
 *
 * @param candidateKey - Raw key presented in `Authorization: Bearer ...`
 * @param storedKeyHashHex - Stored hex HMAC digest from the database
 * @param keyPepperB64 - Base64-encoded 32-byte `KEY_PEPPER`
 * @returns `true` if the HMAC matches
 *
 * @example
 * ```ts
 * const ok = verifyApiKeyHash(rawKey, row.keyHash, pepperB64);
 * ```
 */
export function verifyApiKeyHash(
  candidateKey: string,
  storedKeyHashHex: string,
  keyPepperB64: string,
): boolean {
  const computedHex = hashApiKey(candidateKey, keyPepperB64);
  const a = Buffer.from(computedHex, "hex");
  const b = Buffer.from(storedKeyHashHex, "hex");
  if (a.byteLength !== b.byteLength || a.byteLength !== 32) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Parses and validates the structure of a bearer API key (`hgk_<env>_<43 chars>` or `hgs_<env>_<43 chars>`, SPEC.md section 8.1).
 *
 * @param rawKey - Candidate key string
 * @returns `{ kind, env, prefix }` if structurally valid, or `null` otherwise
 *
 * @example
 * ```ts
 * const parsed = parseApiKey(token);
 * ```
 */
export function parseApiKey(
  rawKey: string,
): { kind: "hgk" | "hgs"; env: "test" | "live"; prefix: string } | null {
  const match = /^(hgk|hgs)_(test|live)_([A-Za-z0-9_-]{43})$/.exec(rawKey);
  if (!match) return null;
  const kind = match[1] as "hgk" | "hgs";
  const env = match[2] as "test" | "live";
  return {
    kind,
    env,
    prefix: rawKey.slice(0, 16),
  };
}

/**
 * Derives the seller-visible pseudonymous `agent_ref` for an agent key:
 * first 10 hex characters of `HMAC-SHA256(KEY_PEPPER, agent_key_id)` (SPEC.md section 8.4).
 *
 * @param agentKeyId - Internal agent key ID (`agk_...`)
 * @param keyPepperB64 - Base64-encoded 32-byte `KEY_PEPPER`
 * @returns 10-character lowercase hex identifier
 *
 * @example
 * ```ts
 * const ref = computeAgentRef("agk_01J9Z3K4M5N6P7Q8R9S0T1U2V3", pepperB64);
 * ```
 */
export function computeAgentRef(agentKeyId: string, keyPepperB64: string): string {
  const pepper = Buffer.from(keyPepperB64, "base64");
  if (pepper.byteLength !== 32) {
    throw new Error("KEY_PEPPER must decode to exactly 32 bytes.");
  }
  return createHmac("sha256", pepper).update(agentKeyId, "utf8").digest("hex").slice(0, 10);
}
