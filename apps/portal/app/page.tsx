/**
 * Public Landing page (`/` — SPEC.md section 11.3).
 *
 * Composes modular landing page sections:
 * - `<SculptureHero>`: Interactive WebGL2 GPGPU liquid sculpture hero
 * - `<AboutSection>`: 3-column editorial bento showcase ("The Settlement Layer for the Agentic Web")
 * - `<HowItWorksSection>`: 2-column interactive 2x2 device card + 4-step accordion
 * - `<CtaSection>`: Drop-in Seller/Buyer SDK switcher + editorial CTA banner
 * - `<HalftoneWordmarkFooter>`: Theme-aware spring-physics halftone wordmark footer
 */

import { SandboxBanner } from "@/components/haggles/primitives";
import { AboutSection } from "@/components/landing/about-section";
import { CtaSection } from "@/components/landing/cta-section";
import HalftoneWordmarkFooter from "@/components/landing/halftone-wordmark-footer";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import SculptureHero from "@/components/ui/liquid-sculpture-hero";

/**
 * Renders the public Haggles landing page (`/`).
 */
export default function LandingPage() {
  const docsUrl =
    process.env.NEXT_PUBLIC_DOCS_URL ?? "https://github.com/haggles/haggles";

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <SandboxBanner mode="sandbox" />

      {/* 1. Interactive WebGL2 Liquid Sculpture Hero */}
      <SculptureHero
        brand="Haggles"
        navLinks={[
          { label: "About", href: "#about" },
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

      {/* 2. Main Editorial Content Sections */}
      <main className="w-full flex-1">
        <AboutSection />
        <HowItWorksSection />
        <CtaSection docsUrl={docsUrl} />
      </main>

      {/* 3. Theme-Aware Interactive Halftone Wordmark Footer */}
      <HalftoneWordmarkFooter
        wordmark="haggles"
        label="Haggles"
        meta="©2026 · HTTP 402 Agentic Commerce on PayPal Rails"
        columns={[
          {
            title: "Platform",
            links: [
              { label: "Buyer Wallet", href: "/buy" },
              { label: "Seller Studio", href: "/sell" },
              { label: "Sign in with PayPal", href: "/login" },
              { label: "Account Settings", href: "/account" },
            ],
          },
          {
            title: "Protocol",
            links: [
              { label: "About Haggles", href: "#about" },
              { label: "How It Works", href: "#how-it-works" },
              { label: "TypeScript SDKs", href: "#sdks" },
            ],
          },
          {
            title: "Resources",
            links: [
              { label: "Documentation", href: docsUrl, external: true },
              {
                label: "GitHub Repository",
                href: "https://github.com/haggles/haggles",
                external: true,
              },
              {
                label: "MIT License",
                href: "https://opensource.org/licenses/MIT",
                external: true,
              },
            ],
          },
        ]}
      />
    </div>
  );
}
