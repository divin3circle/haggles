/**
 * Public Landing page (`/` — SPEC.md section 11.3).
 *
 * Interactive WebGL2 GPGPU liquid sculpture hero with headline
 * "Get paid when AI agents use your API.", 3-step "How it works" cards,
 * 10-line `<CodeTabs>` (Seller / Buyer), and footer with GitHub, Docs, and MIT License.
 */

import { CodeTabs, SandboxBanner } from "@/components/haggles/primitives";
import SculptureHero from "@/components/ui/liquid-sculpture-hero";

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
  const docsUrl =
    process.env.NEXT_PUBLIC_DOCS_URL ?? "https://github.com/haggles/haggles";

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SandboxBanner mode="sandbox" />

      {/* Liquid Sculpture Hero with Haggles wording, template fonts, and Tabler icons */}
      <SculptureHero
        brand="Haggles"
        navLinks={[
          { label: "How it works", href: "#how-it-works" },
          { label: "SDKs", href: "#sdks" },
          { label: "Buyer Portal", href: "/buy" },
          { label: "Seller Studio", href: "/sell" },
          { label: "Docs", href: docsUrl },
        ]}
        navCta={{ label: "Sign in with PayPal", href: "/login" }}
        eyebrow="HTTP 402 · Prepaid micro-payments settled on PayPal rails"
        headline={"Get paid when\nAI agents use your API."}
        headlineAccent="AI agents use your API."
        body="Haggles turns HTTP 402 Payment Required into a fast, policy-guarded payment handshake backed by prepaid PayPal wallets and automatic seller payouts."
        primaryCta={{ label: "Sign in with PayPal", href: "/login" }}
        secondaryCta={{ label: "Explore sandbox portal", href: "/buy" }}
        backdropText="haggles"
        hint="Move across the form"
        hintTouch="Touch the form"
      />

      <main className="mx-auto w-full flex-1 max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        {/* How it works (3 cards) */}
        <section id="how-it-works" className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="font-mono text-xs font-semibold text-primary">
              01 · Seller
            </div>
            <h2 className="mt-2 text-sm font-semibold">
              Seller adds middleware
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Protect any Express or Hono route in two lines. Unpaid requests
              receive a signed <code className="font-mono">402</code> challenge
              with your price in USD.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="font-mono text-xs font-semibold text-primary">
              02 · Agent
            </div>
            <h2 className="mt-2 text-sm font-semibold">
              Agent gets a 402 and pays
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              <code className="font-mono">@haggles/client</code> checks the
              agent key&apos;s per-call and daily caps, obtains an Ed25519
              payment token in milliseconds, and retries once.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="font-mono text-xs font-semibold text-primary">
              03 · Settlement
            </div>
            <h2 className="mt-2 text-sm font-semibold">
              You get paid via PayPal
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Every call is accounted in micro-dollars on a double-entry ledger
              and paid out to your PayPal account on schedule or on demand.
            </p>
          </div>
        </section>

        {/* 10-line CodeTabs block */}
        <section id="sdks" className="mt-12 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Drop-in SDKs for sellers and buyers
            </h2>
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
          <div>
            Haggles Protocol v1 · Built with PayPal Orders v2, Payouts v1 &amp;
            Log in with PayPal
          </div>
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
              href={docsUrl}
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
