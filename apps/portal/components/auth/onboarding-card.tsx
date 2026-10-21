/**
 * Modern frosted-glass Onboarding card content for `/onboarding` (`SPEC.md` section 11.3).
 *
 * Allows a user to enable Buyer (`wallets` provisioning) and/or Seller (`sellers` provisioning)
 * capabilities on their PayPal account before entering the Portal dashboard.
 */

"use client";

import {
  IconArrowRight,
  IconCheck,
  IconCode,
  IconRobot,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { portalApi } from "@/lib/portal-api";
import { cn } from "@/lib/utils";

interface RoleOption {
  id: "buy" | "sell";
  title: string;
  tag: string;
  description: string;
  highlights: string[];
  icon: React.ComponentType<{ className?: string }>;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    id: "buy",
    title: "I want to buy",
    tag: "AI Agent Wallet",
    description:
      "Fund a prepaid USD wallet via PayPal and issue policy-capped keys for your autonomous agents.",
    highlights: [
      "Per-call, daily & monthly USD caps",
      "Automatic HTTP 402 challenge settlement",
    ],
    icon: IconRobot,
  },
  {
    id: "sell",
    title: "I want to sell",
    tag: "API Monetization",
    description:
      "Add two lines of middleware to your API and receive automatic PayPal payouts as agents call it.",
    highlights: [
      "Zero checkout UI — pure HTTP 402 headers",
      "Direct USD payouts to your PayPal payer_id",
    ],
    icon: IconCode,
  },
];

/**
 * Interactive role-selection card body for `/onboarding`.
 *
 * @returns Multi-select Buyer/Seller role cards and continue action
 *
 * @example
 * ```tsx
 * <OnboardingCard />
 * ```
 */
export function OnboardingCard() {
  const router = useRouter();
  const [wantBuy, setWantBuy] = React.useState(true);
  const [wantSell, setWantSell] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const toggleRole = (id: "buy" | "sell") => {
    setError("");
    if (id === "buy") {
      setWantBuy((prev) => !prev);
    } else {
      setWantSell((prev) => !prev);
    }
  };

  const handleContinue = async () => {
    if (!wantBuy && !wantSell) {
      setError("Please select at least one role to continue.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await portalApi.updateMe({
        is_buyer: wantBuy,
        is_seller: wantSell,
      });
      router.push(wantBuy ? "/buy" : "/sell");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="grid gap-3.5 sm:grid-cols-2">
        {ROLE_OPTIONS.map((role) => {
          const selected = role.id === "buy" ? wantBuy : wantSell;
          const Icon = role.icon;

          return (
            <button
              key={role.id}
              type="button"
              onClick={() => toggleRole(role.id)}
              aria-pressed={selected}
              className={cn(
                "group relative flex cursor-pointer flex-col justify-between rounded-2xl border p-4.5 text-left transition-all",
                selected
                  ? "border-primary bg-primary/[0.08] shadow-md ring-1 ring-primary/60 dark:border-primary/80 dark:bg-primary/[0.12]"
                  : "border-border/70 bg-muted/35 hover:border-border hover:bg-muted/60 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]",
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex size-9 items-center justify-center rounded-xl transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-muted text-muted-foreground dark:bg-white/10 dark:text-foreground",
                    )}
                  >
                    <Icon className="size-4.5" />
                  </span>

                  <span
                    className={cn(
                      "inline-flex size-5.5 items-center justify-center rounded-full border transition-all",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/80 bg-background/50 text-transparent dark:border-white/20 dark:bg-white/5",
                    )}
                  >
                    <IconCheck className="size-3.5" />
                  </span>
                </div>

                <div className="mt-3.5 flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {role.title}
                  </span>
                </div>
                <span className="mt-0.5 inline-block text-[10px] font-medium tracking-wide text-primary uppercase">
                  {role.tag}
                </span>

                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {role.description}
                </p>
              </div>

              <ul className="mt-3.5 space-y-1 border-t border-border/50 pt-2.5 dark:border-white/10">
                {role.highlights.map((point) => (
                  <li
                    key={point}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                  >
                    <span className="size-1 rounded-full bg-primary" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2 text-left text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <hr className="border-border/60 dark:border-white/10" />

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={handleContinue}
          disabled={(!wantBuy && !wantSell) || saving}
          className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-5 py-3.5 text-sm font-medium text-primary-foreground shadow-lg transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>
            {saving
              ? "Provisioning workspace…"
              : wantBuy && wantSell
                ? "Continue with Buyer & Seller"
                : wantBuy
                  ? "Continue to Buyer Wallet"
                  : wantSell
                    ? "Continue to Seller Console"
                    : "Select at least one role"}
          </span>
          <IconArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </button>

        <p className="text-center text-[11px] text-muted-foreground">
          Provisions{" "}
          <span className="font-medium text-foreground">
            {wantBuy && wantSell
              ? "Buyer Wallet + Seller Payout Profile"
              : wantBuy
                ? "Buyer Wallet"
                : wantSell
                  ? "Seller Payout Profile"
                  : "no capabilities selected"}
          </span>{" "}
          on your PayPal account.
        </p>
      </div>
    </div>
  );
}
