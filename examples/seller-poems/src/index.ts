/**
 * `seller-poems` Express demo application (`SPEC.md` section 12.2).
 *
 * Exposes:
 * - `GET /poems` (free catalogue of poem IDs)
 * - `GET /poems/random` (`$0.005` — gated by `@haggles/server/express` paywall)
 * - `GET /poems/:id` (`$0.02` — gated by `@haggles/server/express` paywall)
 */

import { paywall } from "@haggles/server/express";
import express, { type Express } from "express";
import rawPoems from "../data/poems.json";

export interface SellerPoemsConfig {
  /** Seller secret key (`hgs_test_...`) */
  sellerKey: string;
  /** Seller public ID (`slr_...`) */
  sellerId: string;
  /** Public base URL of this seller service (e.g. `http://localhost:4011`) */
  publicBaseUrl: string;
  /** Haggles Facilitator URL (e.g. `http://localhost:3001`) */
  facilitatorUrl?: string | undefined;
  /** Optional custom fetch implementation for in-memory testing */
  fetch?: typeof globalThis.fetch | undefined;
}

export interface PoemRecord {
  id: string;
  title: string;
  author: string;
  lines: string[];
}

const poems: PoemRecord[] = rawPoems;

/**
 * Builds the `seller-poems` Express application (`SPEC.md` section 12.2).
 *
 * @param config - Seller poems configuration
 * @returns Configured Express application
 *
 * @example
 * ```ts
 * const app = createSellerPoemsApp({
 *   sellerKey: process.env.HAGGLES_SELLER_KEY!,
 *   sellerId: process.env.HAGGLES_SELLER_ID!,
 *   publicBaseUrl: "http://localhost:4011",
 * });
 * ```
 */
export function createSellerPoemsApp(config: SellerPoemsConfig): Express {
  const app = express();

  const pay = paywall({
    sellerKey: config.sellerKey,
    sellerId: config.sellerId,
    publicBaseUrl: config.publicBaseUrl,
    facilitatorUrl: config.facilitatorUrl ?? "http://localhost:3001",
    fetch: config.fetch,
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "seller-poems" });
  });

  app.get("/poems", (_req, res) => {
    res.json({
      poems: poems.map((p) => ({
        id: p.id,
        title: p.title,
        author: p.author,
      })),
      endpoints: [
        { route: "GET /poems/random", price_usd: "0.005" },
        { route: "GET /poems/:id", price_usd: "0.02" },
      ],
    });
  });

  // Paid route ($0.005): GET /poems/random
  app.get(
    "/poems/random",
    pay({
      price: "0.005",
      description: "Random public-domain or CC0 poem ($0.005)",
      route: "/poems/random",
    }),
    (_req, res) => {
      const picked = poems[0]!;
      res.json(picked);
    },
  );

  // Paid route ($0.02): GET /poems/:id
  app.get(
    "/poems/:id",
    pay({
      price: "0.02",
      description: "Full poem by ID ($0.02)",
      route: "/poems/:id",
    }),
    (req, res) => {
      const id = String(req.params.id ?? "").toLowerCase();
      const found = poems.find((p) => p.id === id) ?? poems[0]!;
      res.json(found);
    },
  );

  return app;
}
