/**
 * `buyer-research-agent` — AI Research Assistant with live HTTP 402 Spend panel (`SPEC.md` section 12.3).
 *
 * Implements the two normative agent tools:
 * - `list_sources()` -> returns the static catalogue of paid seller URLs and descriptions
 * - `buy_source(url)` -> calls `haggles.fetch(url)` via `@haggles/client`, records the receipt,
 *   updates running spend and remaining daily allowance, or captures a `policy_violation` guardrail hit.
 *
 * Supports Gemini via Vertex AI (`@ai-sdk/google-vertex` + Vercel AI SDK `generateText`) when
 * `GOOGLE_VERTEX_PROJECT` is configured, and a deterministic research synthesis fallback for offline/CI runs
 * (`SPEC.md` section 17.1 R7).
 */

import { createVertex } from "@ai-sdk/google-vertex";
import { createHaggles, readReceipt } from "@haggles/client";
import { formatMoney, HagglesError, parseMoney } from "@haggles/core";
import { generateText, tool } from "ai";
import { Hono } from "hono";
import { z } from "zod";

export interface SourceCatalogueEntry {
  id: string;
  seller: string;
  url: string;
  priceUsd: string;
  description: string;
}

export interface SpendLogItem {
  step: number;
  url: string;
  sellerId: string;
  amount: string;
  status: "captured" | "policy_blocked" | "failed";
  paymentId: string | null;
  runningTotal: string;
  remainingAllowance: string;
  errorCode?: string | undefined;
  errorDetail?: string | undefined;
  timestamp: string;
}

export interface ResearchRunResult {
  question: string;
  answer: string;
  sourcesBought: number;
  totalSpent: string;
  dailyAllowance: string;
  remainingAllowance: string;
  summaryLine: string;
  policyHit: {
    triggered: boolean;
    code?: string | undefined;
    detail?: string | undefined;
    message?: string | undefined;
    blockedUrl?: string | undefined;
  };
  spendLog: SpendLogItem[];
}

export interface ResearchAgentConfig {
  /** Agent bearer key (`hgk_test_...`) */
  agentKey: string;
  /** Facilitator base URL */
  facilitatorUrl: string;
  /** Datasets seller base URL */
  datasetsBaseUrl: string;
  /** Poems seller base URL */
  poemsBaseUrl: string;
  /** Per-call max price string passed to `@haggles/client` (default `"0.10"`) */
  maxPrice?: string | undefined;
  /** Daily allowance in USD for the UI Spend panel display (default `"5.00"`) */
  dailyAllowanceUsd?: string | undefined;
  /** Optional custom fetch for in-process testing */
  fetch?: typeof globalThis.fetch | undefined;
}

/**
 * Builds the static source catalogue for `list_sources` (`SPEC.md` section 12.3).
 *
 * @param datasetsBaseUrl - Base URL of `seller-datasets`
 * @param poemsBaseUrl - Base URL of `seller-poems`
 * @returns Array of {@link SourceCatalogueEntry}
 *
 * @example
 * ```ts
 * const sources = buildSourceCatalogue("http://localhost:4010", "http://localhost:4011");
 * ```
 */
export function buildSourceCatalogue(
  datasetsBaseUrl: string,
  poemsBaseUrl: string,
): SourceCatalogueEntry[] {
  const ds = datasetsBaseUrl.replace(/\/$/, "");
  const pm = poemsBaseUrl.replace(/\/$/, "");
  return [
    {
      id: "rent-austin",
      seller: "seller-datasets",
      url: `${ds}/datasets/rent-index?city=austin`,
      priceUsd: "0.03",
      description: "Austin, TX apartment rent index (1BR/2BR median & vacancy)",
    },
    {
      id: "rent-chicago",
      seller: "seller-datasets",
      url: `${ds}/datasets/rent-index?city=chicago`,
      priceUsd: "0.03",
      description: "Chicago, IL apartment rent index (1BR/2BR median & vacancy)",
    },
    {
      id: "transit-austin",
      seller: "seller-datasets",
      url: `${ds}/datasets/transit-fares?city=austin`,
      priceUsd: "0.01",
      description: "Austin, TX public transit single-ride & monthly pass fares",
    },
    {
      id: "transit-chicago",
      seller: "seller-datasets",
      url: `${ds}/datasets/transit-fares?city=chicago`,
      priceUsd: "0.01",
      description: "Chicago, IL public transit single-ride & monthly pass fares",
    },
    {
      id: "poem-haiku",
      seller: "seller-poems",
      url: `${pm}/poems/micro-ledger-haiku`,
      priceUsd: "0.02",
      description: "Four-Oh-Two Haiku poem from seller-poems",
    },
    {
      id: "poem-random",
      seller: "seller-poems",
      url: `${pm}/poems/random`,
      priceUsd: "0.005",
      description: "Random public-domain poem ($0.005 sub-cent micro-payment)",
    },
  ];
}

/**
 * Executes a research agent query using `list_sources` and `buy_source(url)` (`SPEC.md` section 12.3).
 *
 * Uses Gemini on Vertex AI (`@ai-sdk/google-vertex`) when `GOOGLE_VERTEX_PROJECT` is set,
 * or a deterministic tool execution plan when running without cloud credentials.
 *
 * @param question - User research question
 * @param config - Agent configuration
 * @param urlsOverride - Optional explicit list of URLs to purchase in order
 * @returns {@link ResearchRunResult} with answer, live spend log, and policy-hit state
 *
 * @example
 * ```ts
 * const result = await runResearchAgent("Compare rent and transit costs between Austin and Chicago", config);
 * ```
 */
export async function runResearchAgent(
  question: string,
  config: ResearchAgentConfig,
  urlsOverride?: string[],
): Promise<ResearchRunResult> {
  const catalogue = buildSourceCatalogue(
    config.datasetsBaseUrl,
    config.poemsBaseUrl,
  );
  const haggles = createHaggles({
    agentKey: config.agentKey,
    facilitatorUrl: config.facilitatorUrl,
    maxPricePerCall: config.maxPrice ?? "0.10",
    fetch: config.fetch,
  });

  const dailyAllowanceMicros = parseMoney(config.dailyAllowanceUsd ?? "5.00");
  let runningTotalMicros = 0n;
  let sourcesBought = 0;
  const spendLog: SpendLogItem[] = [];
  const purchasedPayloads: Array<{ url: string; amount: string; data: unknown }> = [];
  let policyHit: ResearchRunResult["policyHit"] = { triggered: false };

  const buySource = async (url: string): Promise<{
    ok: boolean;
    pricePaid?: string;
    data?: unknown;
    error?: string;
  }> => {
    try {
      const res = await haggles.fetch(url);
      const receipt = readReceipt(res);
      const paidStr = receipt?.amount ?? "0.00";
      const paidMicros = parseMoney(paidStr);
      runningTotalMicros += paidMicros;
      sourcesBought += 1;

      const remainingMicros =
        dailyAllowanceMicros > runningTotalMicros
          ? dailyAllowanceMicros - runningTotalMicros
          : 0n;

      const data: unknown = await res.json();
      purchasedPayloads.push({ url, amount: paidStr, data });

      spendLog.push({
        step: spendLog.length + 1,
        url,
        sellerId: receipt?.sellerId ?? "slr_demo",
        amount: formatMoney(paidMicros),
        status: "captured",
        paymentId: receipt?.paymentId ?? null,
        runningTotal: formatMoney(runningTotalMicros),
        remainingAllowance: formatMoney(remainingMicros),
        timestamp: new Date().toISOString(),
      });

      return {
        ok: true,
        pricePaid: formatMoney(paidMicros),
        data,
      };
    } catch (err) {
      const remainingMicros =
        dailyAllowanceMicros > runningTotalMicros
          ? dailyAllowanceMicros - runningTotalMicros
          : 0n;

      if (err instanceof HagglesError) {
        const isPolicy = err.code === "policy_violation";
        if (isPolicy) {
          policyHit = {
            triggered: true,
            code: err.code,
            detail: err.message,
            message: err.message,
            blockedUrl: url,
          };
        }
        spendLog.push({
          step: spendLog.length + 1,
          url,
          sellerId: "blocked",
          amount: "0.00",
          status: isPolicy ? "policy_blocked" : "failed",
          paymentId: null,
          runningTotal: formatMoney(runningTotalMicros),
          remainingAllowance: formatMoney(remainingMicros),
          errorCode: err.code,
          errorDetail: err.message,
          timestamp: new Date().toISOString(),
        });
        return {
          ok: false,
          error: `${err.code}: ${err.message}`,
        };
      }

      const msg = err instanceof Error ? err.message : String(err);
      spendLog.push({
        step: spendLog.length + 1,
        url,
        sellerId: "error",
        amount: "0.00",
        status: "failed",
        paymentId: null,
        runningTotal: formatMoney(runningTotalMicros),
        remainingAllowance: formatMoney(remainingMicros),
        errorCode: "request_failed",
        errorDetail: msg,
        timestamp: new Date().toISOString(),
      });
      return { ok: false, error: msg };
    }
  };

  let answer = "";

  // Use Gemini on Vertex AI when GOOGLE_VERTEX_PROJECT is configured and no explicit URL override is passed
  if (process.env.GOOGLE_VERTEX_PROJECT && !urlsOverride) {
    const vertex = createVertex({
      project: process.env.GOOGLE_VERTEX_PROJECT,
      location: process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1",
    });
    const modelId = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
    const llmResult = await generateText({
      model: vertex(modelId),
      temperature: 0,
      maxSteps: 6,
      system:
        "You are the Haggles Research Agent. First call list_sources to discover paid HTTP 402 data endpoints, then call buy_source(url) on the relevant endpoints to answer the user's question concisely with exact numbers and prices paid.",
      prompt: question,
      tools: {
        list_sources: tool({
          description:
            "Returns a catalogue of paid seller URLs, prices, and descriptions.",
          parameters: z.object({}),
          execute: async () => ({ sources: catalogue }),
        }),
        buy_source: tool({
          description:
            "Buys a paid HTTP 402 URL using haggles.fetch(url) and returns the JSON payload and price paid.",
          parameters: z.object({
            url: z.string().url().describe("Exact URL from list_sources to purchase"),
          }),
          execute: async ({ url }) => buySource(url),
        }),
      },
    });
    answer = llmResult.text;
  } else {
    // Deterministic execution path (SPEC.md section 17.1 R7)
    const targetUrls =
      urlsOverride ?? [
        catalogue[0]!.url, // Austin rent ($0.03)
        catalogue[1]!.url, // Chicago rent ($0.03)
        catalogue[2]!.url, // Austin transit ($0.01)
      ];

    for (const url of targetUrls) {
      const outcome = await buySource(url);
      if (!outcome.ok && policyHit.triggered) {
        break;
      }
    }

    const lines: string[] = [
      `Research synthesis for: "${question}"`,
      "",
    ];
    for (const item of purchasedPayloads) {
      lines.push(
        `- Purchased ${item.url} ($${item.amount}): ${JSON.stringify(item.data)}`,
      );
    }
    if (policyHit.triggered) {
      lines.push(
        "",
        `Guardrail triggered (${policyHit.code} / ${policyHit.detail}): ${policyHit.message} when attempting to purchase ${policyHit.blockedUrl}.`,
      );
    }
    answer = lines.join("\n");
  }

  const totalSpent = formatMoney(runningTotalMicros);
  const remainingMicros =
    dailyAllowanceMicros > runningTotalMicros
      ? dailyAllowanceMicros - runningTotalMicros
      : 0n;
  const remainingAllowance = formatMoney(remainingMicros);
  const summaryLine = `Bought ${sourcesBought} source${
    sourcesBought === 1 ? "" : "s"
  } for $${totalSpent}.`;

  return {
    question,
    answer,
    sourcesBought,
    totalSpent,
    dailyAllowance: formatMoney(dailyAllowanceMicros),
    remainingAllowance,
    summaryLine,
    policyHit,
    spendLog,
  };
}

/**
 * Creates the `buyer-research-agent` Hono web application serving the split-screen Chat + live Spend panel UI
 * and JSON API routes (`SPEC.md` section 12.3).
 *
 * @param defaultConfig - Default agent configuration
 * @returns Configured Hono app
 */
export function createResearchAgentApp(
  defaultConfig: ResearchAgentConfig,
): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ status: "ok", service: "buyer-research-agent" }),
  );

  app.get("/api/catalogue", (c) =>
    c.json({
      sources: buildSourceCatalogue(
        defaultConfig.datasetsBaseUrl,
        defaultConfig.poemsBaseUrl,
      ),
    }),
  );

  app.post("/api/research", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      question?: string;
      agentKey?: string;
      dailyAllowanceUsd?: string;
      urls?: string[];
    };
    const question =
      body.question?.trim() ||
      "Compare apartment rent and transit costs between Austin and Chicago.";
    const result = await runResearchAgent(
      question,
      {
        ...defaultConfig,
        agentKey: body.agentKey?.trim() || defaultConfig.agentKey,
        dailyAllowanceUsd:
          body.dailyAllowanceUsd?.trim() || defaultConfig.dailyAllowanceUsd,
      },
      body.urls,
    );
    return c.json(result);
  });

  app.get("/", (c) => {
    const html = `<!doctype html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Haggles Research Agent — HTTP 402 Spend Panel Demo</title>
  <style>
    :root {
      --bg: #121113;
      --card: #1c1a1f;
      --border: #2e2b33;
      --fg: #f4f3f6;
      --muted: #9b96a4;
      --primary: #e08b3e;
      --green: #10b981;
      --red: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.5;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--card);
    }
    .layout {
      max-width: 1180px;
      margin: 24px auto;
      padding: 0 20px;
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 20px;
    }
    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px;
    }
    h1, h2 { margin: 0 0 8px 0; font-size: 16px; }
    p { margin: 0 0 12px 0; font-size: 13px; color: var(--muted); }
    textarea {
      width: 100%;
      min-height: 76px;
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      font-size: 13px;
    }
    .btn-row { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
    button {
      background: var(--primary);
      color: #121113;
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
    }
    button.secondary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
    }
    pre {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .spend-item {
      border-bottom: 1px solid var(--border);
      padding: 10px 0;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .badge-ok { color: var(--green); font-weight: 600; }
    .badge-err { color: var(--red); font-weight: 600; }
    .policy-banner {
      margin-top: 12px;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid var(--red);
      background: rgba(239, 68, 68, 0.12);
      color: #fca5a5;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <header>
    <div><strong>◆ Haggles Research Agent</strong> <span style="color:var(--muted);font-size:12px;">HTTP 402 + PayPal Sandbox Demo</span></div>
    <div style="font-family:monospace;font-size:12px;color:var(--muted);">list_sources · buy_source(url)</div>
  </header>
  <div class="layout">
    <div class="panel">
      <h2>Research Assistant</h2>
      <p>Ask a question that requires purchasing metered data from <code>seller-datasets</code> and <code>seller-poems</code>.</p>
      <textarea id="question">Compare rent and transit costs between Austin and Chicago.</textarea>
      <div class="btn-row">
        <button id="runBtn" onclick="runQuery(false)">Run Research Agent ($0.07)</button>
        <button class="secondary" onclick="runQuery(true)">Trigger Policy Hit Guardrail</button>
      </div>
      <div style="margin-top:16px;">
        <h2>Agent Response</h2>
        <pre id="answer">Click "Run Research Agent" to execute paid HTTP 402 tool calls.</pre>
      </div>
    </div>
    <div class="panel">
      <h2>Live Spend Panel</h2>
      <p>Real-time HTTP 402 receipts and remaining daily policy allowance.</p>
      <div id="spendList"><p>No purchases yet.</p></div>
      <div id="summaryLine" style="margin-top:14px;font-weight:600;font-family:monospace;font-size:13px;"></div>
      <div id="policyBanner"></div>
    </div>
  </div>
  <script>
    async function runQuery(triggerCap) {
      const question = document.getElementById('question').value;
      document.getElementById('answer').textContent = 'Purchasing HTTP 402 sources via @haggles/client...';
      const ds = ${JSON.stringify(defaultConfig.datasetsBaseUrl.replace(/\/$/, ""))};
      const pm = ${JSON.stringify(defaultConfig.poemsBaseUrl.replace(/\/$/, ""))};
      const urls = triggerCap
        ? [ds + '/datasets/rent-index?city=austin', ds + '/datasets/rent-index?city=chicago', pm + '/poems/micro-ledger-haiku', ds + '/datasets/transit-fares?city=austin']
        : undefined;
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, urls })
      });
      const data = await res.json();
      document.getElementById('answer').textContent = data.answer;
      document.getElementById('summaryLine').textContent = data.summaryLine + ' (Remaining daily cap: $' + data.remainingAllowance + ')';
      const listEl = document.getElementById('spendList');
      listEl.innerHTML = data.spendLog.map(item => \`
        <div class="spend-item">
          <div><span class="\${item.status === 'captured' ? 'badge-ok' : 'badge-err'}">[\${item.status.toUpperCase()}]</span> $\${item.amount} — \${item.url}</div>
          <div style="color:var(--muted);margin-top:2px;">Seller: \${item.sellerId} · Running total: $\${item.runningTotal} · Remaining: $\${item.remainingAllowance}</div>
          \${item.errorDetail ? '<div style="color:#fca5a5;margin-top:2px;">Reason: ' + item.errorCode + ' (' + item.errorDetail + ')</div>' : ''}
        </div>
      \`).join('');
      const bannerEl = document.getElementById('policyBanner');
      if (data.policyHit && data.policyHit.triggered) {
        bannerEl.innerHTML = '<div class="policy-banner"><strong>Policy Guardrail Hit:</strong> ' + data.policyHit.code + ' (' + data.policyHit.detail + ') — ' + data.policyHit.message + '</div>';
      } else {
        bannerEl.innerHTML = '';
      }
    }
  </script>
</body>
</html>`;
    return c.html(html);
  });

  return app;
}
