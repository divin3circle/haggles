"use client";

/**
 * Landing Page SDK Showcase & Call-To-Action (`CTA`) Section (`@haggles/portal`).
 *
 * Combines the Seller / Buyer SDK switcher with an editorial CTA banner
 * that invites developers to sign in with PayPal or explore the live Buyer & Seller Studio.
 * Uses theme typography (`font-sans`) and `@tabler/icons-react`.
 */

import {
  IconArrowRight,
  IconCheck,
  IconCoin,
  IconShieldCheck,
  IconWallet,
} from "@tabler/icons-react";
import Link from "next/link";
import { CodeTabs } from "@/components/haggles/primitives";

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

const CTA_HIGHLIGHTS = [
  {
    icon: IconWallet,
    label: "Prepaid PayPal Wallets",
    detail: "Fund once with PayPal Orders v2 ($5–$200)",
  },
  {
    icon: IconShieldCheck,
    label: "Hard Spending Policies",
    detail: "Per-call, daily, monthly & host guardrails",
  },
  {
    icon: IconCoin,
    label: "Automatic Seller Payouts",
    detail: "Whole-cent sweeps via PayPal Payouts v1",
  },
] as const;

/**
 * Renders the SDK switcher and editorial Call-To-Action banner on the public landing page.
 *
 * @example
 * ```tsx
 * <CtaSection docsUrl="http://localhost:3333" />
 * ```
 */
export function CtaSection({ docsUrl }: { docsUrl: string }) {
  return (
    <section
      id="sdks"
      aria-labelledby="cta-heading"
      className="mx-auto w-full max-w-6xl space-y-20 px-4 pt-6 pb-24 sm:px-6 sm:pb-32"
    >
      {/* Drop-in SDKs Block */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Drop-in SDKs for Sellers and Buyers
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Zero crypto wallets or custom tokens — pure HTTP 402 settled in
              USD on PayPal rails.
            </p>
          </div>
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition-opacity hover:opacity-80 sm:text-sm"
          >
            <span>Explore full SDK docs</span>
            <IconArrowRight className="size-4" />
          </a>
        </div>

        <CodeTabs
          tabs={[
            { label: "Seller (@haggles/server)", code: SELLER_SNIPPET },
            { label: "Buyer (@haggles/client)", code: BUYER_SNIPPET },
          ]}
        />
      </div>

      {/* High-Contrast Editorial CTA Banner */}
      <div className="relative overflow-hidden rounded-[2rem] border border-border/80 bg-card p-8 shadow-sm sm:p-12 lg:p-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-primary/12 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -left-24 size-80 rounded-full bg-primary/8 blur-3xl"
        />

        <div className="relative z-10 grid items-center gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1 text-xs font-medium text-primary">
              <IconCheck className="size-3.5" />
              <span>Ready for PayPal Sandbox &amp; AI Agents</span>
            </span>

            <h2
              id="cta-heading"
              className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-5xl sm:leading-[1.06]"
            >
              Put a price on your API.
              <br />
              <span className="text-primary">Let AI agents pay the tab.</span>
            </h2>

            <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Connect your PayPal account in seconds, issue policy-guarded keys
              for your autonomous agents, or monetize any Hono or Express
              endpoint with automatic payouts.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/login"
                className="inline-flex h-12 items-center gap-2.5 rounded-full bg-foreground px-7 text-sm font-medium text-background transition-transform hover:-translate-y-0.5"
              >
                <span>Sign in with PayPal</span>
                <IconArrowRight className="size-4" />
              </Link>
              <Link
                href="/buy"
                className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-background/80 px-6 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <span>Open Sandbox Portal</span>
                <IconArrowRight className="size-4" />
              </Link>
            </div>
          </div>

          {/* Right Column: 3 Crisp Feature Rows */}
          <div className="space-y-3.5 lg:col-span-5">
            {CTA_HIGHLIGHTS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="flex items-start gap-4 rounded-2xl border border-border/70 bg-background/80 p-4 backdrop-blur-xs"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {item.label}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {item.detail}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
