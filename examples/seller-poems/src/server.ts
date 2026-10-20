/**
 * Standalone HTTP server entrypoint for `examples/seller-poems` (`SPEC.md` section 12.2).
 */

import { createSellerPoemsApp } from "./index.js";

const port = Number(process.env.PORT ?? 4011);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const facilitatorUrl = process.env.HAGGLES_FACILITATOR_URL ?? "http://localhost:3001";
const sellerId = process.env.HAGGLES_SELLER_ID ?? "slr_01J9Y8SANDBOXDEMO00000001";
const sellerKey =
  process.env.HAGGLES_SELLER_KEY ?? "hgs_test_demoSellerPoemsKey000000000002";

const app = createSellerPoemsApp({
  sellerId,
  sellerKey,
  publicBaseUrl,
  facilitatorUrl,
});

const server = app.listen(port, () => {
  console.log(
    `[seller-poems] listening on ${publicBaseUrl} (sellerId=${sellerId}, facilitator=${facilitatorUrl})`,
  );
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
