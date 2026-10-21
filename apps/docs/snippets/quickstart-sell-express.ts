/**
 * 5-minute Seller Quickstart (Express) — compiled in CI (SPEC.md section 13.2).
 */

import { paywall } from "@haggles/server/express";
import express from "express";

const app = express();

const pay = paywall({
  sellerKey: process.env.HAGGLES_SELLER_KEY!,
  sellerId: process.env.HAGGLES_SELLER_ID!,
  publicBaseUrl: "https://poems.example.com",
});

app.get(
  "/poems/:id",
  pay({ price: "0.02", description: "One poem by ID ($0.02)" }),
  (req, res) => {
    res.json({ id: req.params.id, title: "Ozymandias" });
  },
);

export default app;
