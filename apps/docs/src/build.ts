/**
 * Static documentation site builder for `@haggles/docs` (`SPEC.md` sections 13.1 and 13.2).
 *
 * Outputs to `apps/docs/dist/`:
 * - Every HTML page from `SPEC.md` section 13.1 with Starlight-inspired sidebar navigation, dark/light theme, and search
 * - `llms.txt` (concise LLM index of all documentation pages)
 * - `llms-full.txt` (complete concatenated Markdown reference of the protocol, SDKs, API routes, and test vectors)
 * - `openapi.json` (copy of root OpenAPI 3.1 specification)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type DocPage, loadDocPages } from "./pages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const DIST_DIR = path.resolve(__dirname, "../dist");

function renderPageHtml(page: DocPage, allPages: DocPage[]): string {
  const sections = Array.from(new Set(allPages.map((p) => p.section)));

  const sidebarHtml = sections
    .map((sec) => {
      const items = allPages
        .filter((p) => p.section === sec)
        .map((p) => {
          const active = p.slug === page.slug ? ' class="active"' : "";
          return `<li><a href="./${p.filename}"${active}>${p.title}</a></li>`;
        })
        .join("\n");
      return `<div class="nav-group"><div class="nav-group-title">${sec}</div><ul>${items}</ul></div>`;
    })
    .join("\n");

  const idx = allPages.findIndex((p) => p.slug === page.slug);
  const prevPage = idx > 0 ? allPages[idx - 1] : undefined;
  const nextPage =
    idx >= 0 && idx < allPages.length - 1 ? allPages[idx + 1] : undefined;

  return `<!doctype html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${page.title} — Haggles Docs</title>
  <meta name="description" content="${page.description}" />
  <link rel="icon" href="./favicon.ico" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #111013;
      --sidebar: #17151a;
      --card: #1c1a20;
      --border: #2c2933;
      --fg: #f4f3f7;
      --muted: #9e99a8;
      --primary: #e08b3e;
      --code-bg: #0c0b0e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.65;
      display: flex;
      min-height: 100vh;
    }
    aside {
      width: 270px;
      flex-shrink: 0;
      background: var(--sidebar);
      border-right: 1px solid var(--border);
      padding: 20px 16px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 15px;
      color: var(--fg);
      text-decoration: none;
      margin-bottom: 16px;
      padding: 0 8px;
    }
    .brand-logo {
      height: 24px;
      width: auto;
      border-radius: 3px;
      object-fit: contain;
    }
    .llms-links {
      display: flex;
      gap: 8px;
      padding: 0 8px 14px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 14px;
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .llms-links a {
      color: var(--primary);
      text-decoration: none;
      border: 1px solid var(--border);
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--card);
    }
    .nav-group { margin-bottom: 18px; }
    .nav-group-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      padding: 0 8px;
      margin-bottom: 6px;
    }
    .nav-group ul { list-style: none; margin: 0; padding: 0; }
    .nav-group li a {
      display: block;
      padding: 5px 8px;
      border-radius: 6px;
      color: var(--muted);
      text-decoration: none;
      font-size: 13px;
    }
    .nav-group li a:hover { color: var(--fg); background: rgba(255,255,255,0.04); }
    .nav-group li a.active {
      color: var(--fg);
      background: rgba(224, 139, 62, 0.16);
      border-left: 2px solid var(--primary);
      font-weight: 600;
    }
    main {
      flex: 1;
      max-width: 880px;
      padding: 40px 48px 80px;
      min-width: 0;
    }
    .eyebrow {
      font-size: 12px;
      font-weight: 600;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    h1 { margin: 4px 0 12px; font-size: 28px; letter-spacing: -0.02em; }
    h2 { margin: 32px 0 12px; font-size: 19px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
    p.lead { font-size: 16px; color: var(--muted); margin-bottom: 24px; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.88em;
      background: var(--card);
      padding: 2px 5px;
      border-radius: 4px;
    }
    .code-block {
      margin: 16px 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--code-bg);
    }
    .code-header {
      display: flex;
      justify-content: space-between;
      padding: 6px 12px;
      background: var(--card);
      border-bottom: 1px solid var(--border);
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--muted);
    }
    pre {
      margin: 0;
      padding: 14px;
      overflow-x: auto;
      font-size: 12.5px;
      line-height: 1.55;
    }
    pre code { background: transparent; padding: 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 13px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    th { background: var(--card); font-weight: 600; font-size: 12px; color: var(--muted); }
    .callout {
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--card);
      margin: 16px 0;
      font-size: 13.5px;
    }
    .callout-info { border-left: 3px solid var(--primary); }
    .callout-warn { border-left: 3px solid #f59e0b; }
    .method-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-family: ui-monospace, monospace;
      font-size: 11px;
      font-weight: 700;
    }
    .method-get { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .method-post { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
    .method-patch { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .pager {
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      gap: 16px;
    }
    .pager a {
      color: var(--primary);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
    }
    @media (max-width: 800px) {
      body { flex-direction: column; }
      aside { width: 100%; height: auto; position: static; }
      main { padding: 24px 20px; }
    }
  </style>
</head>
<body>
  <aside>
    <a class="brand" href="./index.html">
      <img src="./haggles-dark.png" alt="" class="brand-logo" />
      <span>Haggles Docs</span>
    </a>
    <div class="llms-links">
      <a href="./llms.txt">llms.txt</a>
      <a href="./llms-full.txt">llms-full.txt</a>
      <a href="./openapi.json">openapi.json</a>
    </div>
    ${sidebarHtml}
  </aside>
  <main>
    <div class="eyebrow">${page.section}</div>
    <h1>${page.title}</h1>
    ${page.htmlBody}
    <nav class="pager" aria-label="Pagination">
      <div>${prevPage ? `<a href="./${prevPage.filename}">&larr; ${prevPage.title}</a>` : ""}</div>
      <div>${nextPage ? `<a href="./${nextPage.filename}">${nextPage.title} &rarr;</a>` : ""}</div>
    </nav>
  </main>
</body>
</html>`;
}

/**
 * Builds the static documentation site (`apps/docs/dist`), `llms.txt`, `llms-full.txt`, and `openapi.json`
 * (`SPEC.md` sections 13.1 and 13.2).
 *
 * @returns Summary of generated files
 */
export function buildDocsSite(): {
  distDir: string;
  pageCount: number;
  files: string[];
} {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  const pages = loadDocPages(REPO_ROOT);
  const writtenFiles: string[] = [];

  for (const page of pages) {
    const outPath = path.join(DIST_DIR, page.filename);
    fs.writeFileSync(outPath, renderPageHtml(page, pages), "utf8");
    writtenFiles.push(page.filename);
  }

  // Generate llms.txt (concise index per SPEC.md section 13.2)
  const llmsTxt = [
    "# Haggles — HTTP 402 Payment Required for AI Agents on PayPal Rails",
    "",
    "> Open protocol, double-entry micro-dollar facilitator, TypeScript SDKs (@haggles/core, @haggles/client, @haggles/server), and PayPal Orders v2 + Payouts v1 settlement.",
    "",
    "## Documentation Pages",
    ...pages.map(
      (p) => `- [${p.title}](./${p.filename}): ${p.description}`,
    ),
    "",
    "## Machine-Readable Artifacts",
    "- [Full LLM Reference](./llms-full.txt)",
    "- [OpenAPI 3.1 Specification](./openapi.json)",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(DIST_DIR, "llms.txt"), llmsTxt, "utf8");
  writtenFiles.push("llms.txt");

  // Generate llms-full.txt (complete Markdown reference per SPEC.md section 13.2)
  const llmsFullTxt = [
    "# Haggles — Complete Protocol, Architecture, API & SDK Reference (llms-full.txt)",
    "",
    ...pages.map((p) => `${p.markdown}\n\n---\n`),
  ].join("\n");
  fs.writeFileSync(path.join(DIST_DIR, "llms-full.txt"), llmsFullTxt, "utf8");
  writtenFiles.push("llms-full.txt");

  // Copy root openapi.json and brand icons into apps/docs/ and dist/
  const rootOpenapi = path.join(REPO_ROOT, "openapi.json");
  const docsRoot = path.resolve(__dirname, "..");
  fs.copyFileSync(rootOpenapi, path.join(docsRoot, "openapi.json"));
  fs.copyFileSync(rootOpenapi, path.join(DIST_DIR, "openapi.json"));
  for (const iconFile of ["haggles-dark.png", "haggles-light.png", "favicon.png", "favicon.ico"]) {
    const srcIcon = path.join(docsRoot, iconFile);
    if (fs.existsSync(srcIcon)) {
      fs.copyFileSync(srcIcon, path.join(DIST_DIR, iconFile));
      writtenFiles.push(iconFile);
    }
  }
  fs.writeFileSync(path.join(docsRoot, "llms.txt"), llmsTxt, "utf8");
  fs.writeFileSync(path.join(docsRoot, "llms-full.txt"), llmsFullTxt, "utf8");
  writtenFiles.push("openapi.json");

  return {
    distDir: DIST_DIR,
    pageCount: pages.length,
    files: writtenFiles,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = buildDocsSite();
  console.log(
    `[@haggles/docs] Built ${result.pageCount} pages + llms.txt + llms-full.txt + openapi.json into ${result.distDir}`,
  );
}
