/**
 * Standalone HTTP server entrypoint for `examples/buyer-research-agent` (`SPEC.md` section 12.3).
 */

import { createServer } from "node:http";
import { createResearchAgentApp } from "./index.js";

const port = Number(process.env.PORT ?? 4012);
const facilitatorUrl = process.env.HAGGLES_FACILITATOR_URL ?? "http://localhost:3001";
const datasetsBaseUrl = process.env.SELLER_DATASETS_URL ?? "http://localhost:4010";
const poemsBaseUrl = process.env.SELLER_POEMS_URL ?? "http://localhost:4011";
const agentKey =
  process.env.HAGGLES_KEY ?? "hgk_test_demoBuyerResearchAgentKey0000001";
const dailyAllowanceUsd = process.env.DAILY_ALLOWANCE_USD ?? "0.10";

const app = createResearchAgentApp({
  agentKey,
  facilitatorUrl,
  datasetsBaseUrl,
  poemsBaseUrl,
  dailyAllowanceUsd,
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body =
    req.method !== "GET" && req.method !== "HEAD" && chunks.length > 0
      ? Buffer.concat(chunks)
      : undefined;
  const webRes = await app.fetch(
    new Request(url.toString(), {
      method: req.method ?? "GET",
      headers,
      ...(body ? { body } : {}),
    }),
  );
  res.statusCode = webRes.status;
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
});

server.listen(port, () => {
  console.log(
    `[buyer-research-agent] listening on http://localhost:${port} (facilitator=${facilitatorUrl})`,
  );
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
