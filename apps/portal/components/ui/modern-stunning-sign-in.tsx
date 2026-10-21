/**
 * Reusable modern frosted-glass sign-in view (`@/components/ui/modern-stunning-sign-in`),
 * composed from modular {@link AuthShell} and {@link SignInCard} components (`SPEC.md` section 11.3).
 */

"use client";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignInCard } from "@/components/auth/sign-in-card";

/**
 * Full-page frosted-glass Sign-In experience adapted for Haggles' Log in with PayPal flow.
 *
 * @returns Rendered sign-in shell and card
 *
 * @example
 * ```tsx
 * <SignIn1 />
 * ```
 */
const SignIn1 = () => {
  return (
    <AuthShell
      badge="PayPal OpenID Connect"
      title="Sign in to Haggles"
      subtitle={
        <>
          Connect your PayPal account for identity, buyer wallet top-ups, and
          automatic seller payouts via <code className="font-mono">payer_id</code>.
        </>
      }
      maxWidthClassName="max-w-md"
      backHref="/"
      backLabel="Back to home"
    >
      <SignInCard />
    </AuthShell>
  );
};

export { SignIn1 };

export default SignIn1;
