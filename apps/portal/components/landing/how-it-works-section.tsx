"use client";

/**
 * Landing Page "How It Works" Section (`@haggles/portal`).
 *
 * Inspired by clean 2-column interactive step-by-step layouts:
 * - Left: Soft rounded showcase stage containing a central elevated card with the Haggles brand mark
 *   and a 2x2 grid of circular Tabler icon controls (`Paywall`, `Policy`, `Receipt`, `Payouts`)
 *   synced with the active accordion step.
 * - Right: 4-step interactive accordion separated by crisp hairlines, followed by a rounded pill
 *   "Start now" CTA button and a "5 mins to complete steps" time indicator.
 *
 * Uses theme typography (`font-sans`, zero monospace) and `@tabler/icons-react`.
 */

import {
  IconApi,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconCoin,
  IconReceipt,
  IconShieldLock,
} from "@tabler/icons-react";
import Link from "next/link";
import * as React from "react";
import { HagglesLogo } from "@/components/haggles/primitives";
import { cn } from "@/lib/utils";

interface WorkStep {
  id: number;
  shortLabel: string;
  title: string;
  description: string;
  statusNote: string;
  icon: React.ComponentType<{ className?: string }>;
}

const WORK_STEPS: readonly WorkStep[] = [
  {
    id: 1,
    shortLabel: "Paywall",
    title: "Step 1: Protect Your Route in Two Lines",
    description:
      "Drop @haggles/server into any Hono or Express API and set a USD price from $0.0001 to $5.00. Unpaid requests automatically receive an HTTP 402 challenge.",
    statusNote: "402 Payment Required · $0.03 per call",
    icon: IconApi,
  },
  {
    id: 2,
    shortLabel: "Policy",
    title: "Step 2: Set Your Agent Spending Guardrails",
    description:
      "Sign in with PayPal, top up a prepaid wallet once via PayPal Orders v2, and issue a scoped agent key with per-call, daily, and monthly spending caps.",
    statusNote: "Per-call ≤ $0.10 · Daily cap $5.00",
    icon: IconShieldLock,
  },
  {
    id: 3,
    shortLabel: "Receipt",
    title: "Step 3: Agents Pay & Verify in Milliseconds",
    description:
      "When your AI agent encounters a 402 response, @haggles/client obtains an Ed25519 payment token, retries the request once, and receives a signed receipt.",
    statusNote: "Ed25519 JWS · Sub-cent double-entry ledger",
    icon: IconReceipt,
  },
  {
    id: 4,
    shortLabel: "Payouts",
    title: "Step 4: Receive Automatic PayPal Payouts",
    description:
      "Seller earnings accumulate on the double-entry ledger and sweep in whole cents directly to your PayPal account every Monday or on demand.",
    statusNote: "PayPal Payouts v1 · 95% net to seller",
    icon: IconCoin,
  },
];

/**
 * Renders the 2-column interactive "How It Works" section on the public landing page.
 *
 * @example
 * ```tsx
 * <HowItWorksSection />
 * ```
 */
export function HowItWorksSection() {
  const [activeStep, setActiveStep] = React.useState<number>(1);
  const currentStep =
    WORK_STEPS.find((s) => s.id === activeStep) ?? WORK_STEPS[0];

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
    >
      {/* Centered Section Header */}
      <div className="mx-auto max-w-2xl text-center">
        <h2
          id="how-it-works-heading"
          className="text-3xl font-semibold tracking-tight text-foreground sm:text-5xl"
        >
          How It Works
        </h2>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          From two lines of middleware to automatic PayPal payouts, we&apos;ve
          made agentic commerce effortless.
        </p>
      </div>

      {/* 2-Column Split: Left Visual Stage + Right Accordion */}
      <div className="mt-12 grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
        {/* Left Column: Rounded Stage + Elevated 2x2 Circular Icon Card */}
        <div className="lg:col-span-5">
          <div className="flex items-center justify-center rounded-[2rem] border border-border/60 bg-muted/45 p-8 sm:p-12 dark:bg-card/40">
            <div className="w-full max-w-[300px] rounded-3xl border border-border/70 bg-background px-7 py-8 shadow-sm">
              {/* Brand Header inside the Device Card */}
              <div className="flex flex-col items-center text-center">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <HagglesLogo className="h-6" />
                </div>
                <span className="mt-2.5 text-lg font-semibold tracking-tight text-primary">
                  Haggles
                </span>
              </div>

              {/* 2x2 Circular Icon Tiles */}
              <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-6">
                {WORK_STEPS.map((step) => {
                  const Icon = step.icon;
                  const isSelected = step.id === activeStep;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => setActiveStep(step.id)}
                      aria-pressed={isSelected}
                      className="group flex flex-col items-center text-center focus:outline-none"
                    >
                      <span
                        className={cn(
                          "flex size-20 items-center justify-center rounded-full border transition-all duration-300",
                          isSelected
                            ? "border-primary/40 bg-primary text-primary-foreground shadow-md scale-105"
                            : "border-border/80 bg-muted/40 text-muted-foreground shadow-2xs group-hover:border-primary/30 group-hover:text-foreground",
                        )}
                      >
                        <Icon className="size-8 stroke-[1.7]" />
                      </span>
                      <span
                        className={cn(
                          "mt-2.5 text-xs font-medium transition-colors",
                          isSelected
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground group-hover:text-foreground",
                        )}
                      >
                        {step.shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Subtle Live Status Pill at bottom of card */}
              <div className="mt-7 rounded-xl bg-muted/50 px-3 py-2 text-center text-[11px] font-medium text-muted-foreground">
                {currentStep.statusNote}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: 4-Step Accordion + CTA Bar */}
        <div className="lg:col-span-7">
          <div className="border-t border-border/80">
            {WORK_STEPS.map((step) => {
              const isOpen = step.id === activeStep;
              return (
                <div
                  key={step.id}
                  className="border-b border-border/80 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setActiveStep(step.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-4 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="text-base font-medium tracking-tight text-foreground sm:text-lg">
                      {step.title}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {isOpen ? (
                        <IconChevronUp className="size-5" />
                      ) : (
                        <IconChevronDown className="size-5" />
                      )}
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="pb-5 pr-8 text-sm leading-relaxed text-muted-foreground">
                      {step.description}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Bottom Action Row: Pill CTA + 5 mins indicator */}
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-7 text-sm font-medium text-primary-foreground shadow-xs transition-transform hover:-translate-y-0.5 hover:opacity-95"
            >
              Start now
            </Link>
            <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground sm:text-sm">
              <IconClock className="size-4 shrink-0" />
              <span>5 mins to complete steps</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
