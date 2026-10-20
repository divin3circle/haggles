/**
 * Seller Setup page (`/sell/setup`, SPEC.md section 11.5.2).
 *
 * Interactive 4-step checklist:
 * 1. Payout account — shows connected PayPal email and `payer_id`
 * 2. Create a seller key — inline button generating `hgs_test_...` via `<KeyReveal>`
 * 3. Install middleware — `<CodeTabs>` for Hono and Express pre-filled with the seller's real `sellerId`
 * 4. Make a first paid call — sandbox "Generate $0.50 test buyer key" button (`POST /portal/v1/seller/test-key`) and copyable test snippet
 */

"use client";

import { IconCheck, IconKey, IconSparkles } from "@tabler/icons-react";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import {
  CodeTabs,
  CopyButton,
  KeyReveal,
  StatusBadge,
  TruncatedId,
} from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import {
  type PortalSellerKey,
  type PortalSellerSummary,
  portalApi,
} from "@/lib/portal-api";

export default function SellerSetupPage() {
  const [summary, setSummary] = React.useState<PortalSellerSummary | null>(null);
  const [keys, setKeys] = React.useState<PortalSellerKey[]>([]);
  const [revealedSellerKey, setRevealedSellerKey] = React.useState<string | null>(
    null,
  );
  const [testBuyerKey, setTestBuyerKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const [sum, keyList] = await Promise.all([
      portalApi.getSellerSummary(),
      portalApi.listSellerKeys(),
    ]);
    setSummary(sum);
    setKeys(keyList);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const sellerId = summary?.seller_id ?? "slr_01J9Y8SANDBOXDEMO00000001";
  const hasActiveKey = keys.some((k) => k.status === "active");
  const hasCapturedCall = (summary?.recent_calls ?? []).some(
    (c) => c.status === "captured",
  );

  const handleCreateSellerKey = async () => {
    setError(null);
    try {
      const created = await portalApi.createSellerKey("setup-middleware-key");
      setRevealedSellerKey(created.key);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create seller key");
    }
  };

  const handleIssueTestKey = async () => {
    setError(null);
    try {
      const issued = await portalApi.issueSellerTestKey();
      setTestBuyerKey(issued.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue test key");
    }
  };

  const honoSnippet = `import { Hono } from "hono";
import { paywall } from "@haggles/server/hono";

const app = new Hono();

app.get(
  "/v1/datasets/lithium/spot",
  paywall({
    price: "0.03",
    sellerId: "${sellerId}",
    sellerKey: process.env.HAGGLES_SELLER_KEY!,
    description: "Lithium spot price index (USD/mt)",
  }),
  (c) => c.json({ commodity: "lithium_carbonate", spot_usd_mt: 13450 }),
);`;

  const expressSnippet = `import express from "express";
import { paywall } from "@haggles/server/express";

const app = express();

app.get(
  "/v1/datasets/lithium/spot",
  paywall({
    price: "0.03",
    sellerId: "${sellerId}",
    sellerKey: process.env.HAGGLES_SELLER_KEY!,
    description: "Lithium spot price index (USD/mt)",
  }),
  (_req, res) => {
    res.json({ commodity: "lithium_carbonate", spot_usd_mt: 13450 });
  },
);`;

  const testCallSnippet = `HAGGLES_KEY=${testBuyerKey ?? "hgk_test_..."} bun -e '
import { createPaidFetch } from "@haggles/client";
const paidFetch = createPaidFetch({ apiKey: process.env.HAGGLES_KEY! });
const res = await paidFetch("http://localhost:4010/v1/datasets/lithium/spot");
console.log(res.status, await res.json());
'`;

  return (
    <AppShell
      title="Seller setup"
      description="Complete these 4 steps to gate any Hono or Express route with HTTP 402 and receive PayPal Payouts."
    >
      {error ? (
        <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="space-y-6">
        {/* Step 1 */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <IconCheck className="size-3.5" />
              </span>
              <h2 className="text-sm font-semibold">1. Payout account</h2>
            </div>
            <StatusBadge status="active" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Connected PayPal destination for <code className="font-mono">POST /v1/payments/payouts</code>:
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-md border border-border bg-muted/30 px-3.5 py-2.5 text-xs">
            <div>
              <span className="text-muted-foreground">Email: </span>
              <span className="font-medium">
                {summary?.payout_email ?? "builder@sandbox.paypal.example.com"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">PayPal Payer ID: </span>
              <TruncatedId
                value={summary?.payout_paypal_payer_id ?? "WDJJHEBZ4X2LY"}
                head={8}
                tail={4}
              />
            </div>
            <div>
              <span className="text-muted-foreground">Seller ID: </span>
              <TruncatedId value={sellerId} head={10} tail={4} />
            </div>
          </div>
        </section>

        {/* Step 2 */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
                  hasActiveKey
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {hasActiveKey ? <IconCheck className="size-3.5" /> : "2"}
              </span>
              <h2 className="text-sm font-semibold">2. Create a seller key</h2>
            </div>
            <Button size="xs" onClick={handleCreateSellerKey}>
              <IconKey className="size-3.5" />
              Generate seller key
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Your seller middleware uses <code className="font-mono">HAGGLES_SELLER_KEY</code> (<code className="font-mono">hgs_test_...</code>) to call <code className="font-mono">POST /v1/settle</code> and <code className="font-mono">POST /v1/release</code>.
          </p>
        </section>

        {/* Step 3 */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              3
            </span>
            <h2 className="text-sm font-semibold">
              3. Install <code className="font-mono">@haggles/server</code> middleware
            </h2>
          </div>
          <p className="mt-2 mb-3 text-xs text-muted-foreground">
            Pre-filled with your Seller ID (<code className="font-mono">{sellerId}</code>):
          </p>
          <CodeTabs
            tabs={[
              { label: "Hono", language: "ts", code: honoSnippet },
              { label: "Express", language: "ts", code: expressSnippet },
            ]}
          />
        </section>

        {/* Step 4 */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
                  hasCapturedCall
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {hasCapturedCall ? <IconCheck className="size-3.5" /> : "4"}
              </span>
              <h2 className="text-sm font-semibold">4. Make a first paid call</h2>
            </div>
            <Button variant="outline" size="xs" onClick={handleIssueTestKey}>
              <IconSparkles className="size-3.5" />
              Generate $0.50 test buyer key
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            In sandbox mode, you can mint a pre-funded <code className="font-mono">$0.50</code> buyer agent key to test your endpoint end-to-end:
          </p>

          {testBuyerKey ? (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-xs">
              <span className="truncate">HAGGLES_KEY={testBuyerKey}</span>
              <CopyButton text={testBuyerKey} label="Copy test buyer key" />
            </div>
          ) : null}

          <div className="mt-3">
            <CodeTabs
              tabs={[{ label: "Test command", language: "bash", code: testCallSnippet }]}
            />
          </div>
        </section>
      </div>

      <KeyReveal
        open={Boolean(revealedSellerKey)}
        title="Seller key created — save your secret"
        envVarName="HAGGLES_SELLER_KEY"
        fullKey={revealedSellerKey}
        onClose={() => setRevealedSellerKey(null)}
      />
    </AppShell>
  );
}
