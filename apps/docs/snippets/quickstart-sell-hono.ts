/**
 * 5-minute Seller Quickstart (Hono) — compiled in CI (SPEC.md section 13.2).
 */

import { paywall } from "@haggles/server/hono";
import { Hono } from "hono";

const app = new Hono();

const pay = paywall({
  sellerKey: process.env.HAGGLES_SELLER_KEY!,
  sellerId: process.env.HAGGLES_SELLER_ID!,
  publicBaseUrl: "https://datasets.example.com",
});

app.get(
  "/datasets/rent-index",
  pay({ price: "0.03", description: "Apartment rent index by city ($0.03)" }),
  (c) => {
    const city = c.req.query("city") ?? "austin";
    return c.json({ city, median_1br_usd: 1620, vacancy_rate_pct: 7.8 });
  },
);

export default app;
