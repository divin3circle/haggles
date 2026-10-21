/**
 * Portal Login page (`/login` — SPEC.md section 11.3).
 *
 * Uses the frosted-glass `AuthShell` and `SignInCard` components adapted for
 * Log in with PayPal (OpenID Connect) and the Sandbox Demo Account flow.
 */

import { SignIn1 } from "@/components/ui/modern-stunning-sign-in";

/**
 * Renders the `/login` route.
 *
 * @returns Frosted-glass PayPal Sign-In page
 *
 * @example
 * ```tsx
 * <LoginPage />
 * ```
 */
export default function LoginPage() {
  return <SignIn1 />;
}
