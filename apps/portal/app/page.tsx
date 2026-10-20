/**
 * Public Landing page (`/` — SPEC.md section 11.3).
 *
 * Hero headline "Get paid when AI agents use your API.", 3-step "How it works" cards,
 * 10-line `<CodeTabs>` (Seller / Buyer), and footer with GitHub, Docs, and MIT License.
 */

import Link from "next/link";
import { CodeTabs, SandboxBanner } from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";

const SELLER_SNIPPET = `import { paywall } from "@haggles/server/hono";

const pay = paywall({
  sellerKey: process.env.HAGGLES_SELLER_KEY!,
  sellerId: process.env.HAGGLES_SELLER_ID!,
  publicBaseUrl: "https://datasets.example.com",
});

app.get("/datasets/rent-index", pay({ price: "0.03", description: "Metro rent index" }), (c) => {
  return c.json({ city: c.req.query("city"), medianRentUsd: 3180 });
});`;

const BUYER_SNIPPET = `import { createHaggles, readReceipt } from "@haggles/client";

const haggles = createHaggles({
  agentKey: process.env.HAGGLES_KEY!,
  maxPricePerCall: "0.10",
});

const res = await haggles.fetch("https://datasets.example.com/datasets/rent-index?city=sf");
const receipt = readReceipt(res); // { paymentId: "pay_01J...", amount: "0.03", ... }`;

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SandboxBanner mode="sandbox" />

      <header className="border-b border-border bg-card/40">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="inline-flex size-5 items-center justify-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
              ◆
            </span>
            <span>Haggles</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/buy">
              <Button variant="ghost" size="default">
                Dashboard
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="default" size="default">
                Sign in with PayPal
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex-1 max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        {/* Hero */}
        <section className="max-w-2xl space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
            <span className="font-mono text-[11px] text-primary">HTTP 402</span>
            <span>·</span>
            <span>Prepaid micro-payments settled on PayPal rails</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
            Get paid when AI agents use your API.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            Haggles turns HTTP <code className="font-mono text-foreground">402 Payment Required</code> into a fast,
            policy-guarded payment handshake backed by prepaid PayPal wallets and automatic seller payouts.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link href="/login">
              <Button variant="default" size="lg">
                Sign in with PayPal
              </Button>
            </Link>
            <Link href="/buy">
              <Button variant="outline" size="lg">
                Explore sandbox portal
              </Button>
            </Link>
            <a
              href={process.env.NEXT_PUBLIC_DOCS_URL ?? "https://github.com/haggles/haggles"}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="ghost" size="lg">
                Read the docs
              </Button>
            </a>
          </div>
        </section>

        {/* How it works (3 cards) */}
        <section className="mt-16 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="font-mono text-xs font-semibold text-primary">01 · Seller</div>
            <h2 className="mt-2 text-sm font-semibold">Seller adds middleware</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Protect any Express or Hono route in two lines. Unpaid requests receive a signed{" "}
              <code className="font-mono">402</code> challenge with your price in USD.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="font-mono text-xs font-semibold text-primary">02 · Agent</div>
            <h2 className="mt-2 text-sm font-semibold">Agent gets a 402 and pays</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              <code className="font-mono">@haggles/client</code> checks the agent key&apos;s per-call and daily caps,
              obtains an Ed25519 payment token in milliseconds, and retries once.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="font-mono text-xs font-semibold text-primary">03 · Settlement</div>
            <h2 className="mt-2 text-sm font-semibold">You get paid via PayPal</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Every call is accounted in micro-dollars on a double-entry ledger and paid out to your PayPal account on
              schedule or on demand.
            </p>
          </div>
        </section>

        {/* 10-line CodeTabs block */}
        <section className="mt-12 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Drop-in SDKs for sellers and buyers</h2>
            <span className="font-mono text-xs text-muted-foreground">
              bun add @haggles/server @haggles/client
            </span>
          </div>
          <CodeTabs
            tabs={[
              { label: "Seller (@haggles/server)", code: SELLER_SNIPPET },
              { label: "Buyer (@haggles/client)", code: BUYER_SNIPPET },
            ]}
          />
        </section>
      </main>

      <footer className="border-t border-border bg-card/30 py-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 text-xs text-muted-foreground sm:px-6">
          <div>Haggles Protocol v1 · Built with PayPal Orders v2, Payouts v1 &amp; Log in with PayPal</div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/haggles/haggles"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground"
            >
              GitHub
            </a>
            <a
              href={process.env.NEXT_PUBLIC_DOCS_URL ?? "https://github.com/haggles/haggles"}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground"
            >
              Docs
            </a>
            <span>MIT License</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
