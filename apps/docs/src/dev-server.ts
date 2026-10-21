/**
 * Local development server for `@haggles/docs` (`bun --filter @haggles/docs dev`).
 */

import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { buildDocsSite, DIST_DIR } from "./build.js";

const port = Number(process.env.PORT ?? 4321);
buildDocsSite();

const server = createServer((req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(DIST_DIR, relative);

  if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  if (filePath.endsWith(".html")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
  } else if (filePath.endsWith(".json")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  } else {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
  }

  res.end(fs.readFileSync(filePath));
});

server.listen(port, () => {
  console.log(`[@haggles/docs] serving static docs at http://localhost:${port}`);
});
