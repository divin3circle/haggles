/**
 * Standalone HTTP server entrypoint for `examples/seller-datasets` (`SPEC.md` section 12.1).
 */

import { createServer } from "node:http";
import { createSellerDatasetsApp } from "./index.js";

const port = Number(process.env.PORT ?? 4010);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const facilitatorUrl = process.env.HAGGLES_FACILITATOR_URL ?? "http://localhost:3001";
const sellerId = process.env.HAGGLES_SELLER_ID ?? "slr_01J9Y8SANDBOXDEMO00000001";
const sellerKey =
  process.env.HAGGLES_SELLER_KEY ?? "hgs_test_demoSellerDatasetsKey0000000001";

const app = createSellerDatasetsApp({
  sellerId,
  sellerKey,
  publicBaseUrl,
  facilitatorUrl,
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", publicBaseUrl);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
  }
  const webRes = await app.fetch(
    new Request(url.toString(), { method: req.method ?? "GET", headers }),
  );
  res.statusCode = webRes.status;
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
});

server.listen(port, () => {
  console.log(
    `[seller-datasets] listening on ${publicBaseUrl} (sellerId=${sellerId}, facilitator=${facilitatorUrl})`,
  );
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
