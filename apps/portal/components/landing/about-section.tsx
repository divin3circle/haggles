"use client";

/**
 * Landing Page "About" Bento Section (`@haggles/portal`).
 *
 * Inspired by editorial 3-column feature bento layouts:
 * 1. Left card: Full-bleed atmospheric Unsplash photography with a frosted-glass live telemetry overlay.
 * 2. Middle card: Soft surface card with floating policy pill badges and a bottom agent prompt card.
 * 3. Right card: Soft surface card with stacked conversational & settlement status cards.
 *
 * Uses theme typography (`font-sans`, zero monospace) and `@tabler/icons-react`.
 */

import {
  IconArrowUp,
  IconArrowsMaximize,
  IconCheck,
  IconPlus,
  IconShieldCheck,
  IconSparkles,
} from "@tabler/icons-react";
import { HagglesLogo } from "@/components/haggles/primitives";

const FLOATING_POLICY_PILLS = [
  {
    label: "Per-Call Cap ≤ $0.10",
    tone: "tinted",
    className: "left-4 top-6",
  },
  {
    label: "Daily Allowance $5.00",
    tone: "solid",
    className: "right-4 top-2",
  },
  {
    label: "Host Allowlist",
    tone: "tinted",
    className: "left-1/2 -translate-x-1/2 top-16",
  },
  {
    label: "Auto-Refund on 5xx",
    tone: "solid",
    className: "left-4 top-28",
  },
  {
    label: "Ed25519 Signed",
    tone: "solid",
    className: "right-4 top-30",
  },
] as const;

/**
 * Renders the 3-column editorial "About Haggles" bento section on the public landing page.
 *
 * @example
 * ```tsx
 * <AboutSection />
 * ```
 */
export function AboutSection() {
  return (
    <section
      id="about"
      aria-labelledby="about-heading"
      className="mx-auto w-full max-w-6xl px-4 pt-20 pb-12 sm:px-6 sm:pt-28 sm:pb-16"
    >
      {/* Editorial Headline & Lead */}
      <div className="max-w-2xl">
        <h2
          id="about-heading"
          className="text-3xl font-semibold tracking-tight text-foreground sm:text-5xl sm:leading-[1.08]"
        >
          The Settlement Layer
          <span className="align-super text-xs font-medium text-muted-foreground">
            {" "}
            v1
          </span>
          <br />
          for the Agentic Web.
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Turn every HTTP endpoint into a self-serve, metered revenue stream
          backed by prepaid PayPal wallets, sub-cent double-entry accounting,
          and programmable spending guardrails.
        </p>
      </div>

      {/* 3-Column Bento Grid */}
      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {/* Card 1: Atmospheric Image + Frosted Glass Telemetry Card */}
        <article className="relative flex min-h-[470px] flex-col justify-between overflow-hidden rounded-3xl border border-border/60 p-6 text-white shadow-sm sm:p-7">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80"
            alt="Warm abstract metallic gradient backdrop"
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
          <div
            className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/75"
            aria-hidden="true"
          />

          <div className="relative z-10">
            <h3 className="text-xl font-semibold tracking-tight text-white">
              Micro-Dollar Telemetry
            </h3>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/80">
              Unlock real-time visibility into every paid API call, seller net
              revenue, and sub-cent platform fee without floating-point drift.
            </p>
          </div>

          {/* Frosted Glass Inner Widget */}
          <div className="relative z-10 mt-8 rounded-2xl border border-white/20 bg-white/12 p-5 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-white text-neutral-900 shadow-xs">
                <HagglesLogo className="h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">
                  Haggles Ledger
                </div>
                <div className="text-xs text-white/75">
                  Live facilitator settlement metrics:
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex min-w-[104px] items-center gap-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  <IconArrowUp className="size-5 shrink-0 text-white/90" />
                  <span>99.8%</span>
                </div>
                <div className="text-xs leading-snug text-white/80">
                  Instant HTTP 402
                  <br />
                  Token Redemption
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex min-w-[104px] items-center gap-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  <IconArrowUp className="size-5 shrink-0 text-white/90" />
                  <span>95%</span>
                </div>
                <div className="text-xs leading-snug text-white/80">
                  Net Seller Share
                  <br />
                  Paid via PayPal
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex min-w-[104px] items-center gap-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    <IconPlus className="size-5 shrink-0 text-white/90" />
                    <span>2ms</span>
                  </div>
                  <div className="text-xs leading-snug text-white/80">
                    Local Ed25519
                    <br />
                    JWKS Verification
                  </div>
                </div>

                <span
                  aria-hidden="true"
                  className="inline-flex size-7 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-white/80"
                >
                  <IconArrowsMaximize className="size-3.5" />
                </span>
              </div>
            </div>
          </div>
        </article>

        {/* Card 2: Policy-Guarded Autonomy (Floating Pills + Prompt Box) */}
        <article className="flex min-h-[470px] flex-col justify-between rounded-3xl border border-border/70 bg-muted/40 p-6 sm:p-7 dark:bg-card/60">
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Policy-Guarded Autonomy
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Agent spending that is human-bounded, cryptographically scoped,
              and enforced inside serializable ledger transactions.
            </p>
          </div>

          {/* Floating Pills Stage */}
          <div className="relative my-6 h-44 w-full" aria-hidden="true">
            {FLOATING_POLICY_PILLS.map((pill) => (
              <span
                key={pill.label}
                className={
                  "absolute inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium shadow-2xs transition-transform duration-300 hover:-translate-y-0.5 " +
                  (pill.tone === "tinted"
                    ? "border border-primary/25 bg-primary/10 text-primary "
                    : "border border-border/80 bg-background text-foreground ") +
                  pill.className
                }
              >
                <IconShieldCheck className="size-3.5 shrink-0 opacity-80" />
                <span>{pill.label}</span>
              </span>
            ))}
          </div>

          {/* Bottom Callout Card */}
          <div className="rounded-2xl border border-border/70 bg-background p-5 shadow-xs">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <HagglesLogo className="h-4" />
              </div>
              <span className="text-xs font-semibold text-foreground">
                Haggles Policy Guard
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-foreground/90 sm:text-sm">
              How much can your autonomous research agent spend today before
              Haggles halts further calls?
            </p>
          </div>
        </article>

        {/* Card 3: PayPal-Backed Settlement (Stacked Conversational Cards) */}
        <article className="flex min-h-[470px] flex-col justify-between rounded-3xl border border-border/70 bg-muted/40 p-6 sm:p-7 dark:bg-card/60">
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              PayPal-Backed Settlement
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Upgrade API monetization with one-click PayPal wallet funding and
              scheduled whole-cent seller payouts.
            </p>
          </div>

          <div className="mt-6 space-y-3.5">
            {/* Top Bubble */}
            <div className="rounded-2xl border border-border/70 bg-background p-4 shadow-xs">
              <p className="text-xs leading-relaxed text-foreground sm:text-sm">
                <span className="font-semibold text-primary">
                  @haggles/client
                </span>{" "}
                Fetch metro rent &amp; transit datasets for Austin and San
                Francisco within my $0.10 daily cap.
              </p>
            </div>

            {/* Bottom Response Card */}
            <div className="rounded-2xl border border-border/70 bg-background p-5 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <IconSparkles className="size-4" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    Haggles Facilitator
                  </span>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  <IconCheck className="size-3" />
                  Settled
                </span>
              </div>

              <div className="mt-3.5 text-xs font-semibold text-foreground">
                Bought 2 verified datasets for $0.04
              </div>

              <div className="mt-2.5 space-y-2">
                <div className="h-2 w-full rounded-full bg-muted" />
                <div className="h-2 w-5/6 rounded-full bg-muted" />
                <div className="h-2 w-4/6 rounded-full bg-muted" />
              </div>

              <div className="mt-4 border-t border-border/60 pt-3 text-xs font-medium text-muted-foreground">
                PayPal Payouts v1 · Whole-cent sweep ready
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
