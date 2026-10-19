import { InsufficientFundsError } from "@haggles/core";
import { describe, expect, it } from "vitest";
import {
  buildApp,
  INITIAL_SCHEMA_SQL,
  LOGGER_REDACT_PATHS,
  loadConfig,
} from "../src/index.js";
import * as schema from "../src/db/schema.js";
import { generateOpenApiJson } from "../src/scripts/generate-openapi.js";

describe("@haggles/api — configuration validation (SPEC 14.5)", () => {
  it("loads sensible defaults in development and test", () => {
    const cfg = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    expect(cfg.PORT).toBe(3000);
    expect(cfg.PAYPAL_MODE).toBe("mock");
    expect(cfg.PLATFORM_FEE_BPS).toBe(500);
    expect(cfg.PRICE_MIN_MICROS).toBe(100n);
    expect(cfg.PRICE_MAX_MICROS).toBe(5_000_000n);
    expect(cfg.WALLET_MAX_MICROS).toBe(500_000_000n);
  });

  it("forbids PAYPAL_MODE=live until R3 is resolved (SPEC 14.2)", () => {
    expect(() => loadConfig({ PAYPAL_MODE: "live" })).toThrow(/PAYPAL_MODE/);
  });

  it("requires explicit MASTER_KEY and KEY_PEPPER in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/MASTER_KEY/);
  });

  it("requires PayPal credentials when PAYPAL_MODE=sandbox", () => {
    expect(() => loadConfig({ PAYPAL_MODE: "sandbox" })).toThrow(/PAYPAL_CLIENT_ID/);
  });
});

describe("@haggles/api — Fastify skeleton, /health, /ready, and RFC 9457 errors", () => {
  it("serves GET /health with 200 OK, HSTS, and x-request-id", async () => {
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.headers["x-request-id"]).toMatch(/^req_[0-9A-Z]{26}$/);
    expect(res.headers["strict-transport-security"]).toContain("max-age=31536000");
    await app.close();
  });

  it("serves GET /ready with 200 when ready and 503 when database is not ready", async () => {
    const appReady = await buildApp({
      config: loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      checkReady: async () => ({ ready: true }),
    });
    const okRes = await appReady.inject({ method: "GET", url: "/ready" });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json()).toEqual({ status: "ok" });
    await appReady.close();

    const appNotReady = await buildApp({
      config: loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      checkReady: async () => ({ ready: false, reason: "Missing migration: 0000_initial_schema" }),
    });
    const failRes = await appNotReady.inject({ method: "GET", url: "/ready" });
    expect(failRes.statusCode).toBe(503);
    expect(failRes.json()).toEqual({
      status: "not_ready",
      reason: "Missing migration: 0000_initial_schema",
    });
    await appNotReady.close();
  });

  it("formats unknown routes and HagglesError exceptions as RFC 9457 application/problem+json", async () => {
    const app = await buildApp({
      config: loadConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        PUBLIC_API_URL: "https://api.haggles.example.com",
      }),
    });

    app.get("/test-error", async () => {
      throw new InsufficientFundsError("Available balance 0.01 is less than 0.02.");
    });

    const notFound = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.headers["content-type"]).toContain("application/problem+json");
    expect(notFound.json()).toMatchObject({
      type: "https://api.haggles.example.com/errors/not_found",
      title: "Not found",
      status: 404,
      code: "not_found",
    });

    const insufficient = await app.inject({ method: "GET", url: "/test-error" });
    expect(insufficient.statusCode).toBe(409);
    expect(insufficient.headers["content-type"]).toContain("application/problem+json");
    expect(insufficient.json()).toMatchObject({
      type: "https://api.haggles.example.com/errors/insufficient_funds",
      title: "Insufficient funds",
      status: 409,
      code: "insufficient_funds",
      detail: "Available balance 0.01 is less than 0.02.",
    });

    await app.close();
  });

  it("generates a valid OpenAPI 3.1 document and configures secret redaction paths", async () => {
    const openApiRaw = await generateOpenApiJson();
    const doc = JSON.parse(openApiRaw) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/health"]).toBeDefined();
    expect(doc.paths["/ready"]).toBeDefined();

    expect(LOGGER_REDACT_PATHS).toContain("req.headers.authorization");
    expect(LOGGER_REDACT_PATHS).toContain("req.headers.cookie");
    expect(LOGGER_REDACT_PATHS).toContain('req.headers["haggles-payment"]');
  });
});

describe("@haggles/api — database schema & migration coverage (SPEC 6.1, 6.2)", () => {
  it("defines all 17 SPEC 6.1 tables and the deferred double-entry trigger", () => {
    const requiredTables = [
      "accounts",
      "sessions",
      "wallets",
      "agent_keys",
      "agent_key_spend",
      "sellers",
      "seller_keys",
      "endpoints",
      "payments",
      "topups",
      "payouts",
      "ledger_accounts",
      "ledger_transactions",
      "ledger_entries",
      "signing_keys",
      "webhook_events",
      "audit_log",
    ];
    for (const table of requiredTables) {
      expect(INITIAL_SCHEMA_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(INITIAL_SCHEMA_SQL).toContain("CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced");
    expect(INITIAL_SCHEMA_SQL).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(schema.accounts).toBeDefined();
    expect(schema.ledgerEntries).toBeDefined();
  });
});
