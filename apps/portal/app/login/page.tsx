/**
 * Portal Login page (`/login` — SPEC.md section 11.3).
 *
 * Centered card with "Sign in with PayPal" button, sandbox note, and links to onboarding/dashboard.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { HagglesLogo, SandboxBanner } from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();

  const handlePayPalLogin = async () => {
    try {
      const res = await fetch("/portal/v1/auth/paypal/start", {
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { authorize_url?: string };
        if (data.authorize_url && !data.authorize_url.includes("client_id=&")) {
          window.location.href = data.authorize_url;
          return;
        }
      }
    } catch {
      // Fallback to sandbox onboarding flow when running in mock/offline mode
    }
    router.push("/onboarding");
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SandboxBanner mode="sandbox" />

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xs">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <HagglesLogo />
            <span>Haggles</span>
          </div>

          <h1 className="mt-4 text-lg font-semibold tracking-tight">Sign in with PayPal</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Use your PayPal account for identity, buyer wallet top-ups, and automatic seller payouts via{" "}
            <code className="font-mono">payer_id</code>.
          </p>

          <div className="mt-6 space-y-2.5">
            <Button
              variant="default"
              size="lg"
              className="w-full"
              onClick={handlePayPalLogin}
            >
              Continue with PayPal Sandbox
            </Button>

            <Link href="/buy" className="block">
              <Button variant="outline" size="lg" className="w-full">
                Enter Sandbox Demo Account
              </Button>
            </Link>
          </div>

          <div className="mt-6 rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">Sandbox environment:</strong> Log in with PayPal uses the
            confidential authorization-code flow (<code className="font-mono">openid profile email paypalattributes</code>
            ). No real money moves.
          </div>

          <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              ← Back to home
            </Link>
            <span>Privacy · Terms</span>
          </div>
        </div>
      </div>
    </div>
  );
}
