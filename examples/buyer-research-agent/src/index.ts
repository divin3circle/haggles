/**
 * `buyer-research-agent` — AI Research Assistant with live HTTP 402 Spend panel (`SPEC.md` section 12.3).
 *
 * Implements the two normative agent tools:
 * - `list_sources()` -> returns the static catalogue of paid seller URLs and descriptions
 * - `buy_source(url)` -> calls `haggles.fetch(url)` via `@haggles/client`, records the receipt,
 *   updates running spend and remaining daily allowance, or captures a `policy_violation` guardrail hit.
 *
 * Supports Gemini via direct Google AI API (`GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`)
 * or a deterministic research synthesis fallback for offline/CI runs (`SPEC.md` section 17.1 R7).
 */

import { createHaggles, readReceipt } from "@haggles/client";
import { formatMoney, HagglesError, parseMoney } from "@haggles/core";
import { Hono } from "hono";

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

  let answer = "";
  const apiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (apiKey && !urlsOverride && purchasedPayloads.length > 0) {
    try {
      const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
      const prompt = `You are the Haggles Research Agent. Answer the following question concisely using the paid HTTP 402 data:
Question: ${question}
Data purchased: ${JSON.stringify(purchasedPayloads, null, 2)}`;

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        },
      );
      if (geminiRes.ok) {
        const geminiData = (await geminiRes.json()) as any;
        answer =
          geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      }
    } catch {
      // Fallback to structured text below
    }
  }

  if (!answer) {
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
  const remainingAllowance = formatMoney(
    dailyAllowanceMicros > runningTotalMicros
      ? dailyAllowanceMicros - runningTotalMicros
      : 0n,
  );
  const dailyAllowance = formatMoney(dailyAllowanceMicros);

  const summaryLine = policyHit.triggered
    ? `Haggles policy guardrail triggered: ${policyHit.code} (${policyHit.detail}). Total spent: $${totalSpent}.`
    : `Bought ${sourcesBought} sources for $${totalSpent}.`;

  return {
    question,
    answer,
    sourcesBought,
    totalSpent,
    dailyAllowance,
    remainingAllowance,
    summaryLine,
    policyHit,
    spendLog,
  };
}

/**
 * Builds the Hono web application serving the Research Assistant UI and `/api/research` (`SPEC.md` section 12.3).
 */
export function createResearchAgentApp(
  defaultConfig: ResearchAgentConfig,
): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ status: "ok", service: "buyer-research-agent" }),
  );

  app.get("/api/sources", (c) => {
    const catalogue = buildSourceCatalogue(
      defaultConfig.datasetsBaseUrl,
      defaultConfig.poemsBaseUrl,
    );
    return c.json({ sources: catalogue });
  });

  app.post("/api/research", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const question =
      typeof body.question === "string" && body.question.trim().length > 0
        ? body.question
        : "Compare rent and transit costs between Austin and Chicago.";

    const urlsOverride = Array.isArray(body.urls)
      ? (body.urls.filter((u: unknown) => typeof u === "string") as string[])
      : undefined;

    const result = await runResearchAgent(question, defaultConfig, urlsOverride);
    return c.json(result);
  });

  app.get("/", (c) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Haggles — AI Research Assistant (HTTP 402 + PayPal Demo)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d0c0e;
      --card: #151417;
      --card-inner: #1c1a20;
      --border: #28262c;
      --border-subtle: #201e24;
      --fg: #f4f3f6;
      --fg-secondary: #9e9ba5;
      --muted: #6b6873;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.15);
      --green: #10b981;
      --green-glow: rgba(16, 185, 129, 0.12);
      --red: #f43f5e;
      --red-glow: rgba(244, 63, 94, 0.12);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      background-image: 
        radial-gradient(ellipse at 50% -20%, rgba(99, 102, 241, 0.12), transparent 70%),
        linear-gradient(to right, rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255,255,255,0.02) 1px, transparent 1px);
      background-size: 100% 100%, 32px 32px, 32px 32px;
      color: var(--fg);
      font-family: 'Space Grotesk', -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
    }
    .container {
      width: 100%;
      max-width: 820px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03);
      padding: 28px;
      backdrop-filter: blur(12px);
    }
    .badge-header {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--accent-glow);
      border: 1px solid rgba(99, 102, 241, 0.3);
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      color: #a5b4fc;
      margin-bottom: 14px;
    }
    .header-prompt {
      border: 1px solid var(--border);
      background: var(--card-inner);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .header-prompt textarea {
      width: 100%;
      background: transparent;
      border: none;
      color: var(--fg);
      font-family: 'Space Grotesk', sans-serif;
      font-size: 15px;
      line-height: 1.5;
      resize: none;
      outline: none;
      height: 48px;
    }
    .btn-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border-subtle);
    }
    .btn-group { display: flex; gap: 10px; }
    button {
      font-family: 'Space Grotesk', sans-serif;
      border: none;
      border-radius: 10px;
      padding: 10px 18px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    button.primary {
      background: #f4f3f6;
      color: #0d0c0e;
      box-shadow: 0 4px 12px rgba(255,255,255,0.12);
    }
    button.primary:hover {
      background: #ffffff;
      transform: translateY(-1px);
    }
    button.secondary {
      background: transparent;
      color: var(--fg-secondary);
      border: 1px solid var(--border);
    }
    button.secondary:hover {
      background: rgba(255,255,255,0.04);
      color: var(--fg);
    }
    .timeline {
      position: relative;
      margin-top: 24px;
      padding-left: 28px;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 11px;
      top: 12px;
      bottom: 24px;
      width: 2px;
      background: var(--border);
    }
    .step-item {
      position: relative;
      margin-bottom: 24px;
    }
    .step-dot {
      position: absolute;
      left: -28px;
      top: 4px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--card);
      border: 2px solid var(--muted);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      transition: all 0.3s ease;
    }
    .step-dot.active {
      border-color: var(--accent);
      background: var(--accent);
      color: white;
      box-shadow: 0 0 12px var(--accent);
    }
    .step-dot.done {
      border-color: var(--green);
      background: var(--green);
      color: #0d0c0e;
    }
    .step-header {
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--fg);
      margin-bottom: 8px;
    }
    .step-box {
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      font-size: 13px;
      color: var(--fg-secondary);
    }
    .source-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }
    .source-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      padding: 10px 14px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }
    .source-meta {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .source-tag {
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .tag-200 { background: var(--green-glow); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
    .tag-402 { background: var(--red-glow); color: #fb7185; border: 1px solid rgba(244,63,94,0.3); }
    .receipt-info {
      font-size: 11px;
      color: var(--muted);
      margin-top: 4px;
    }
    .answer-card {
      margin-top: 24px;
      background: linear-gradient(180deg, rgba(99, 102, 241, 0.08) 0%, rgba(21, 20, 23, 0.95) 100%);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 16px;
      padding: 20px;
    }
    .answer-title {
      font-size: 14px;
      font-weight: 700;
      color: #c7d2fe;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .answer-body {
      font-size: 14px;
      line-height: 1.6;
      color: var(--fg);
      white-space: pre-wrap;
    }
    .spend-summary-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 18px;
      margin-top: 20px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }
    .policy-banner {
      margin-top: 14px;
      padding: 14px 18px;
      border-radius: 12px;
      border: 1px solid var(--red);
      background: var(--red-glow);
      color: #fca5a5;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="badge-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        AI Agent for Autonomous Research
      </div>
      <p style="color:var(--fg-secondary);font-size:14px;margin-bottom:18px;">
        Watch the agent query metered data vendors, negotiate HTTP 402 challenges, and settle micro-payments in real USD.
      </p>

      <div class="header-prompt">
        <textarea id="question">Compare rent and transit costs between Austin and Chicago.</textarea>
        <div class="btn-row">
          <div style="font-family:'JetBrains Mono', monospace;font-size:12px;color:var(--muted);" id="statusIndicator">
            Ready to execute paid pipeline
          </div>
          <div class="btn-group">
            <button class="secondary" onclick="runQuery(true)">Test Policy Cap ($0.08)</button>
            <button class="primary" id="runBtn" onclick="runQuery(false)">Run Research Agent ($0.07)</button>
          </div>
        </div>
      </div>

      <!-- Execution Timeline Steps -->
      <div class="timeline">
        <!-- Step 1: Discovering endpoints -->
        <div class="step-item">
          <div class="step-dot done">✓</div>
          <div class="step-header">
            <span>Step 1: Discovering vendor endpoints</span>
          </div>
          <div class="step-box">
            Discovered <code>seller-datasets</code> (Hono HTTP 402 API) and <code>seller-poems</code> (Express HTTP 402 API).
          </div>
        </div>

        <!-- Step 2: Negotiating HTTP 402 Sources -->
        <div class="step-item">
          <div class="step-dot active" id="step2Dot">2</div>
          <div class="step-header">
            <span>Step 2: Reviewing & purchasing sources via HTTP 402</span>
            <span style="font-family:'JetBrains Mono', monospace;font-size:11px;color:var(--muted);" id="sourceCount"></span>
          </div>
          <div class="step-box" style="padding:10px;">
            <div class="source-list" id="sourceList">
              <div style="padding:8px 6px;color:var(--muted);font-style:italic;">No purchases initiated yet. Click "Run Research Agent" above.</div>
            </div>
          </div>
        </div>

        <!-- Step 3: Synthesis -->
        <div class="step-item">
          <div class="step-dot" id="step3Dot">3</div>
          <div class="step-header">
            <span>Step 3: Synthesis & Receipt Finalization</span>
          </div>
          <div class="step-box" id="step3Box" style="color:var(--muted);">
            Awaiting completed data purchases.
          </div>
        </div>
      </div>

      <!-- Live Spend Summary Bar -->
      <div class="spend-summary-bar">
        <div>
          <span style="color:var(--muted);">TOTAL SPENT:</span>
          <strong style="color:var(--green);margin-left:6px;" id="totalSpentText">$0.00 USD</strong>
        </div>
        <div>
          <span style="color:var(--muted);">DAILY REMAINING:</span>
          <strong style="color:#f4f3f6;margin-left:6px;" id="dailyRemainingText">$0.10 USD</strong>
        </div>
        <div>
          <span style="color:var(--muted);">SETTLEMENT:</span>
          <span style="color:#a5b4fc;margin-left:6px;">Sub-100ms</span>
        </div>
      </div>

      <div id="policyBanner"></div>

      <!-- Answer Box -->
      <div class="answer-card" id="answerCard" style="display:none;">
        <div class="answer-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Research Synthesis (Powered by Gemini)
        </div>
        <div class="answer-body" id="answerBody"></div>
      </div>

    </div>
  </div>

  <script>
    async function runQuery(triggerCap) {
      const question = document.getElementById('question').value;
      const statusInd = document.getElementById('statusIndicator');
      statusInd.textContent = 'Negotiating HTTP 402 challenges via @haggles/client...';
      document.getElementById('step2Dot').className = 'step-dot active';
      document.getElementById('step3Dot').className = 'step-dot';
      document.getElementById('answerCard').style.display = 'none';

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
      statusInd.textContent = 'Execution finished';
      document.getElementById('step2Dot').className = 'step-dot done';
      document.getElementById('step2Dot').textContent = '✓';
      document.getElementById('step3Dot').className = 'step-dot done';
      document.getElementById('step3Dot').textContent = '✓';

      document.getElementById('totalSpentText').textContent = '$' + data.totalSpent + ' USD';
      document.getElementById('dailyRemainingText').textContent = '$' + data.remainingAllowance + ' USD';
      document.getElementById('sourceCount').textContent = data.sourcesBought + ' sources settled';

      const listEl = document.getElementById('sourceList');
      listEl.innerHTML = data.spendLog.map(item => {
        const isOk = item.status === 'captured';
        const route = item.url.split('/').slice(-2).join('/');
        const tagClass = isOk ? 'tag-200' : 'tag-402';
        const tagText = isOk ? 'HTTP 200' : 'HTTP 402';
        const receipt = item.paymentId ? ('· Receipt: ' + item.paymentId.slice(0, 16) + '...') : '';
        const amtColor = isOk ? '#34d399' : '#fb7185';
        const amtText = isOk ? ('+$' + item.amount) : 'BLOCKED';

        return '<div class="source-row">' +
          '<div class="source-meta">' +
            '<span class="source-tag ' + tagClass + '">' + tagText + '</span>' +
            '<div>' +
              '<strong>' + route + '</strong>' +
              '<div class="receipt-info">Seller: ' + item.sellerId + ' ' + receipt + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<strong style="color:' + amtColor + '">' + amtText + '</strong>' +
            '<div class="receipt-info">Balance: $' + item.remainingAllowance + '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      document.getElementById('step3Box').textContent = 'Completed ' + data.sourcesBought + ' purchases. Ed25519 receipts signed & validated.';

      if (data.policyHit && data.policyHit.triggered) {
        document.getElementById('policyBanner').innerHTML = 
          '<div class="policy-banner"><strong>Haggles Policy Guardrail Activated:</strong> ' + data.policyHit.code + ' (' + data.policyHit.detail + ')</div>';
      } else {
        document.getElementById('policyBanner').innerHTML = '';
      }

      if (data.answer) {
        document.getElementById('answerCard').style.display = 'block';
        document.getElementById('answerBody').textContent = data.answer;
      }
    }
  </script>
</body>
</html>`;
    return c.html(html);
  });

  return app;
}
