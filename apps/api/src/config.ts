/**
 * Environment configuration parser and validator for `@haggles/api` and `@haggles/worker`.
 *
 * Implements SPEC.md sections 2.3, 8.1, 14.2, and 14.5.
 */

import { z } from "zod";

const DEV_DEFAULT_MASTER_KEY = Buffer.alloc(32, 0x11).toString("base64");
const DEV_DEFAULT_KEY_PEPPER = Buffer.alloc(32, 0x22).toString("base64");

function isBase6432Bytes(val: string): boolean {
  try {
    const buf = Buffer.from(val, "base64");
    return buf.byteLength === 32 && buf.toString("base64") === val;
  } catch {
    return false;
  }
}

const BigIntEnvSchema = z.union([z.bigint(), z.string(), z.number()]).transform((val, ctx) => {
  try {
    const n = BigInt(val);
    if (n < 0n) {
      ctx.addIssue({ code: "custom", message: "Micro-dollar limit must be >= 0" });
      return z.NEVER;
    }
    return n;
  } catch {
    ctx.addIssue({ code: "custom", message: `Invalid integer micro-dollar value: ${String(val)}` });
    return z.NEVER;
  }
});

/**
 * Validated runtime configuration for the Haggles API and worker processes (SPEC.md section 14.5).
 *
 * @example
 * ```ts
 * const config = loadConfig(process.env);
 * console.log(config.PORT); // 3000
 * ```
 */
export interface ApiConfig {
  NODE_ENV: "development" | "test" | "production";
  HAGGLES_ENV: "test" | "live";
  PORT: number;
  HOST: string;
  DATABASE_URL: string;
  REDIS_URL?: string | undefined;
  PUBLIC_API_URL: string;
  PUBLIC_PORTAL_URL: string;
  MASTER_KEY: string;
  KEY_PEPPER: string;
  PAYPAL_MODE: "mock" | "sandbox";
  PAYPAL_CLIENT_ID?: string | undefined;
  PAYPAL_CLIENT_SECRET?: string | undefined;
  PAYPAL_WEBHOOK_ID?: string | undefined;
  PAYPAL_OIDC_REDIRECT_URI?: string | undefined;
  PLATFORM_FEE_BPS: number;
  PRICE_MIN_MICROS: bigint;
  PRICE_MAX_MICROS: bigint;
  TOPUP_MIN_MICROS: bigint;
  TOPUP_MAX_MICROS: bigint;
  WALLET_MAX_MICROS: bigint;
  PAYOUT_MIN_MICROS: bigint;
  LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
}

const RawConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HAGGLES_ENV: z.enum(["test", "live"]).default("test"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default("0.0.0.0"),
    DATABASE_URL: z
      .string()
      .min(1)
      .default("postgres://haggles:haggles@localhost:5432/haggles"),
    REDIS_URL: z.string().min(1).optional(),
    PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
    PUBLIC_PORTAL_URL: z.string().url().default("http://localhost:3001"),
    MASTER_KEY: z
      .string()
      .refine(isBase6432Bytes, "MASTER_KEY must be base64-encoded 32 bytes")
      .default(DEV_DEFAULT_MASTER_KEY),
    KEY_PEPPER: z
      .string()
      .refine(isBase6432Bytes, "KEY_PEPPER must be base64-encoded 32 bytes")
      .default(DEV_DEFAULT_KEY_PEPPER),
    PAYPAL_MODE: z
      .string()
      .default("mock")
      .refine(
        (val): val is "mock" | "sandbox" => val === "mock" || val === "sandbox",
        "PAYPAL_MODE must be 'mock' or 'sandbox' ('live' is forbidden until R3 is resolved, SPEC 14.2)",
      ),
    PAYPAL_CLIENT_ID: z.string().min(1).optional(),
    PAYPAL_CLIENT_SECRET: z.string().min(1).optional(),
    PAYPAL_WEBHOOK_ID: z.string().min(1).optional(),
    PAYPAL_OIDC_REDIRECT_URI: z.string().url().optional(),
    PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(500),
    PRICE_MIN_MICROS: BigIntEnvSchema.default(100n),
    PRICE_MAX_MICROS: BigIntEnvSchema.default(5_000_000n),
    TOPUP_MIN_MICROS: BigIntEnvSchema.default(5_000_000n),
    TOPUP_MAX_MICROS: BigIntEnvSchema.default(200_000_000n),
    WALLET_MAX_MICROS: BigIntEnvSchema.default(500_000_000n),
    PAYOUT_MIN_MICROS: BigIntEnvSchema.default(1_000_000n),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === "production") {
      if (cfg.MASTER_KEY === DEV_DEFAULT_MASTER_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["MASTER_KEY"],
          message: "Production requires an explicit MASTER_KEY (never the development default).",
        });
      }
      if (cfg.KEY_PEPPER === DEV_DEFAULT_KEY_PEPPER) {
        ctx.addIssue({
          code: "custom",
          path: ["KEY_PEPPER"],
          message: "Production requires an explicit KEY_PEPPER (never the development default).",
        });
      }
    }
    if (cfg.PAYPAL_MODE === "sandbox") {
      if (!cfg.PAYPAL_CLIENT_ID) {
        ctx.addIssue({
          code: "custom",
          path: ["PAYPAL_CLIENT_ID"],
          message: "PAYPAL_CLIENT_ID is required when PAYPAL_MODE=sandbox.",
        });
      }
      if (!cfg.PAYPAL_CLIENT_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["PAYPAL_CLIENT_SECRET"],
          message: "PAYPAL_CLIENT_SECRET is required when PAYPAL_MODE=sandbox.",
        });
      }
      if (!cfg.PAYPAL_WEBHOOK_ID) {
        ctx.addIssue({
          code: "custom",
          path: ["PAYPAL_WEBHOOK_ID"],
          message: "PAYPAL_WEBHOOK_ID is required when PAYPAL_MODE=sandbox.",
        });
      }
    }
  });

/**
 * Validates an environment map against SPEC.md section 14.5 and returns a typed {@link ApiConfig}.
 *
 * @param env - Raw environment map (defaults to `process.env`)
 * @returns Validated {@link ApiConfig}
 * @throws {Error} With a clear diagnostic message if any configuration variable is invalid
 *
 * @example
 * ```ts
 * const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" });
 * ```
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const cleaned: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    cleaned[k] = v === "" ? undefined : v;
  }
  const parsed = RawConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".") || "env"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
