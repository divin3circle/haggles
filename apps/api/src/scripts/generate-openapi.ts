/**
 * Generates (or checks for drift in) the repo-root `openapi.json` from Fastify TypeBox route schemas.
 *
 * Implements SPEC.md sections 3.3, 13.2, and 14.4.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const OPENAPI_PATH = fileURLToPath(new URL("../../../../openapi.json", import.meta.url));

/**
 * Builds the OpenAPI 3.1 JSON string from the Fastify application.
 *
 * @returns Formatted `openapi.json` string
 *
 * @example
 * ```ts
 * const specJson = await generateOpenApiJson();
 * ```
 */
export async function generateOpenApiJson(): Promise<string> {
  const config = loadConfig({
    NODE_ENV: "development",
    LOG_LEVEL: "silent",
    PUBLIC_API_URL: "https://api.haggles.example.com",
    PUBLIC_PORTAL_URL: "https://portal.haggles.example.com",
  });
  const app = await buildApp({ config });
  try {
    await app.ready();
    const spec = app.swagger();
    return `${JSON.stringify(spec, null, 2)}\n`;
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const generated = await generateOpenApiJson();

  if (checkOnly) {
    if (!existsSync(OPENAPI_PATH)) {
      console.error("ERROR: openapi.json does not exist at repo root. Run `bun --filter @haggles/api openapi:generate`.");
      process.exit(1);
    }
    const committed = readFileSync(OPENAPI_PATH, "utf8");
    if (committed !== generated) {
      console.error("ERROR: openapi.json is out of date with route schemas. Run `bun --filter @haggles/api openapi:generate`.");
      process.exit(1);
    }
    console.log("openapi.json is up to date.");
    return;
  }

  writeFileSync(OPENAPI_PATH, generated, "utf8");
  console.log(`Wrote ${OPENAPI_PATH}`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
