/**
 * `seller-datasets` Hono demo application (`SPEC.md` section 12.1).
 *
 * Exposes:
 * - `GET /datasets/summary` (free — demonstrates that unpaid routes pass through normally)
 * - `GET /datasets/rent-index?city=` (`$0.03` — gated by `@haggles/server/hono` paywall)
 * - `GET /datasets/transit-fares?city=` (`$0.01` — gated by `@haggles/server/hono` paywall)
 */

import { paywall } from "@haggles/server/hono";
import { Hono } from "hono";
import rawDataset from "../data/cities.json";

export interface SellerDatasetsConfig {
  /** Seller secret key (`hgs_test_...`) */
  sellerKey: string;
  /** Seller public ID (`slr_...`) */
  sellerId: string;
  /** Public base URL of this seller service (e.g. `http://localhost:4010`) */
  publicBaseUrl: string;
  /** Haggles Facilitator URL (e.g. `http://localhost:3001`) */
  facilitatorUrl?: string | undefined;
  /** Optional custom fetch implementation for in-memory testing */
  fetch?: typeof globalThis.fetch | undefined;
}

interface CityRecord {
  city: string;
  slug: string;
  rent_index: {
    median_1br_usd: number;
    median_2br_usd: number;
    yoy_change_pct: number;
    vacancy_rate_pct: number;
  };
  transit_fares: {
    agency: string;
    single_ride_usd: string;
    day_pass_usd: string;
    monthly_pass_usd: string;
  };
}

const cities = rawDataset.cities as Record<string, CityRecord>;

/**
 * Builds the `seller-datasets` Hono application (`SPEC.md` section 12.1).
 *
 * @param config - Seller datasets configuration
 * @returns Configured Hono application
 *
 * @example
 * ```ts
 * const app = createSellerDatasetsApp({
 *   sellerKey: process.env.HAGGLES_SELLER_KEY!,
 *   sellerId: process.env.HAGGLES_SELLER_ID!,
 *   publicBaseUrl: "http://localhost:4010",
 * });
 * ```
 */
export function createSellerDatasetsApp(config: SellerDatasetsConfig): Hono {
  const app = new Hono();

  const pay = paywall({
    sellerKey: config.sellerKey,
    sellerId: config.sellerId,
    publicBaseUrl: config.publicBaseUrl,
    facilitatorUrl: config.facilitatorUrl ?? "http://localhost:3001",
    fetch: config.fetch,
  });

  app.get("/health", (c) => c.json({ status: "ok", service: "seller-datasets" }));

  // Free route — shows that unpaid routes work normally alongside 402 routes
  app.get("/datasets/summary", (c) => {
    return c.json({
      notice: rawDataset.notice,
      updated_at: rawDataset.updated_at,
      available_cities: Object.values(cities).map((entry) => ({
        slug: entry.slug,
        city: entry.city,
      })),
      endpoints: [
        {
          route: "GET /datasets/rent-index?city=<slug>",
          price_usd: "0.03",
          description: "Apartment rent index & vacancy benchmark by city",
        },
        {
          route: "GET /datasets/transit-fares?city=<slug>",
          price_usd: "0.01",
          description: "Public transit single-ride, day-pass, and monthly-pass fares by city",
        },
      ],
    });
  });

  // Paid route ($0.03): GET /datasets/rent-index?city=
  app.get(
    "/datasets/rent-index",
    pay({
      price: "0.03",
      description: "City apartment rent index benchmark ($0.03)",
      route: "/datasets/rent-index",
    }),
    (c) => {
      const cityKey = (c.req.query("city") ?? "austin").toLowerCase();
      const record = cities[cityKey] ?? cities.austin!;
      return c.json({
        notice: rawDataset.notice,
        updated_at: rawDataset.updated_at,
        city: record.city,
        slug: record.slug,
        rent_index: record.rent_index,
      });
    },
  );

  // Paid route ($0.01): GET /datasets/transit-fares?city=
  app.get(
    "/datasets/transit-fares",
    pay({
      price: "0.01",
      description: "City public transit fare schedule ($0.01)",
      route: "/datasets/transit-fares",
    }),
    (c) => {
      const cityKey = (c.req.query("city") ?? "austin").toLowerCase();
      const record = cities[cityKey] ?? cities.austin!;
      return c.json({
        notice: rawDataset.notice,
        updated_at: rawDataset.updated_at,
        city: record.city,
        slug: record.slug,
        transit_fares: record.transit_fares,
      });
    },
  );

  return app;
}
