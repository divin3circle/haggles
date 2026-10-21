/**
 * Verification tests for `@haggles/docs` (`SPEC.md` sections 13.1 and 13.2).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocsSite, DIST_DIR } from "../src/build.js";

describe("@haggles/docs static site, snippets, llms.txt, and OpenAPI reference (SPEC.md § 13)", () => {
  it("builds all required documentation pages, llms.txt, llms-full.txt, and openapi.json", () => {
    const res = buildDocsSite();
    expect(res.pageCount).toBe(17);

    const expectedFiles = [
      "index.html",
      "quickstart-sell.html",
      "quickstart-buy.html",
      "concepts-ledger.html",
      "concepts-policies.html",
      "concepts-lifecycle.html",
      "concepts-security.html",
      "protocol-wire.html",
      "protocol-errors.html",
      "api-reference.html",
      "sdk-reference.html",
      "guides-paywall.html",
      "guides-ai-agent.html",
      "guides-production.html",
      "ops-self-hosting.html",
      "ops-runbook.html",
      "faq.html",
      "llms.txt",
      "llms-full.txt",
      "openapi.json",
    ];

    for (const file of expectedFiles) {
      const fullPath = path.join(DIST_DIR, file);
      expect(fs.existsSync(fullPath), `Missing ${file} in apps/docs/dist`).toBe(
        true,
      );
    }

    const llmsTxt = fs.readFileSync(path.join(DIST_DIR, "llms.txt"), "utf8");
    expect(llmsTxt).toContain("Quickstart: Sell (5 minutes)");
    expect(llmsTxt).toContain("Quickstart: Buy (5 minutes)");
    expect(llmsTxt).toContain("llms-full.txt");

    const llmsFull = fs.readFileSync(
      path.join(DIST_DIR, "llms-full.txt"),
      "utf8",
    );
    expect(llmsFull).toContain("Assumption A1");
    expect(llmsFull).toContain("Risk R3");
    expect(llmsFull).toContain("@haggles/server/hono");
    expect(llmsFull).toContain("policy_violation");
  });

  it("verifies every Mintlify MDX page referenced in docs.json exists and uses mermaid diagrams", () => {
    const docsRoot = path.resolve(DIST_DIR, "..");
    const docsJson = JSON.parse(
      fs.readFileSync(path.join(docsRoot, "docs.json"), "utf8"),
    ) as {
      navigation: { tabs: Array<{ groups: Array<{ pages: string[] }> }> };
    };

    const allPages = docsJson.navigation.tabs.flatMap((t) =>
      t.groups.flatMap((g) => g.pages),
    );
    expect(allPages.length).toBeGreaterThanOrEqual(16);

    for (const pageSlug of allPages) {
      const mdxPath = path.join(docsRoot, `${pageSlug}.mdx`);
      expect(fs.existsSync(mdxPath), `Missing Mintlify page: ${pageSlug}.mdx`).toBe(
        true,
      );
    }

    const introMdx = fs.readFileSync(
      path.join(docsRoot, "introduction.mdx"),
      "utf8",
    );
    expect(introMdx).toContain("```mermaid");
    expect(introMdx).toContain("sequenceDiagram");
  });
});
