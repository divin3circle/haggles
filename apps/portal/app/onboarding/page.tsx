/**
 * First-login Onboarding page (`/onboarding` — SPEC.md section 11.3).
 *
 * Uses the frosted-glass `AuthShell` and `OnboardingCard` components so users can enable
 * Buyer (`wallets` row) and/or Seller (`sellers` row) roles on their PayPal account.
 */

import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingCard } from "@/components/auth/onboarding-card";

/**
 * Renders the `/onboarding` route.
 *
 * @returns Frosted-glass Buyer/Seller role selection page
 *
 * @example
 * ```tsx
 * <OnboardingPage />
 * ```
 */
export default function OnboardingPage() {
  return (
    <AuthShell
      badge="Workspace Setup"
      title="How will you use Haggles?"
      subtitle="Select one or both roles for your PayPal account. You can change this anytime in Account settings."
      maxWidthClassName="max-w-xl"
      backHref="/login"
      backLabel="Back to sign in"
    >
      <OnboardingCard />
    </AuthShell>
  );
}
