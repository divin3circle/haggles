/**
 * First-login Onboarding page (`/onboarding` — SPEC.md section 11.3).
 *
 * Two selectable cards "I want to sell" / "I want to buy" (multi-select, at least one required),
 * "Continue" button that updates `is_buyer`/`is_seller` and provisions the wallet and/or seller record.
 */

"use client";

import { IconCheck, IconCode, IconRobot } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { HagglesLogo, SandboxBanner } from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import { portalApi } from "@/lib/portal-api";
import { cn } from "@/lib/utils";

export default function OnboardingPage() {
  const router = useRouter();
  const [wantBuy, setWantBuy] = React.useState(true);
  const [wantSell, setWantSell] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const handleContinue = async () => {
    if (!wantBuy && !wantSell) return;
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
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SandboxBanner mode="sandbox" />

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-xl rounded-lg border border-border bg-card p-6 text-card-foreground">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <HagglesLogo />
            <span>Haggles</span>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">How will you use Haggles?</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Select one or both roles. You can change this anytime in Account.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setWantBuy((v) => !v)}
              aria-pressed={wantBuy}
              className={cn(
                "flex flex-col justify-between rounded-lg border p-4 text-left transition-all",
                wantBuy
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border bg-card hover:bg-muted/40",
              )}
            >
              <div>
                <div className="flex items-center justify-between">
                  <IconRobot className="size-5 text-primary" />
                  {wantBuy ? (
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <IconCheck className="size-3.5" />
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 text-sm font-semibold">I want to buy</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Fund a prepaid USD wallet via PayPal and issue policy-capped keys for your AI agents.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setWantSell((v) => !v)}
              aria-pressed={wantSell}
              className={cn(
                "flex flex-col justify-between rounded-lg border p-4 text-left transition-all",
                wantSell
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border bg-card hover:bg-muted/40",
              )}
            >
              <div>
                <div className="flex items-center justify-between">
                  <IconCode className="size-5 text-primary" />
                  {wantSell ? (
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <IconCheck className="size-3.5" />
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 text-sm font-semibold">I want to sell</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Add two lines of middleware to your API and receive automatic PayPal payouts as agents call it.
                </p>
              </div>
            </button>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <Button
              variant="default"
              size="lg"
              disabled={(!wantBuy && !wantSell) || saving}
              onClick={handleContinue}
            >
              {saving ? "Saving…" : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
