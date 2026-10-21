/**
 * Shared authentication & onboarding shell (`SPEC.md` section 11.3).
 *
 * Provides the frosted-glass card frame, ambient background lighting, theme switcher,
 * circular brand emblem, and developer social proof footer used by `/login` and `/onboarding`.
 */

"use client"

import { IconArrowLeft, IconMoon, IconSun } from "@tabler/icons-react"
import { motion } from "motion/react"
import Link from "next/link"
import { useTheme } from "next-themes"
import * as React from "react"
import { HagglesLogo, SandboxBanner } from "@/components/haggles/primitives"
import { cn } from "@/lib/utils"

const EASE_OUT_EXPO: [number, number, number, number] = [0.22, 1, 0.36, 1]

const DEVELOPER_AVATARS = [
  {
    src: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80",
    alt: "AI Agent Builder",
  },
  {
    src: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80",
    alt: "API Seller",
  },
  {
    src: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=120&q=80",
    alt: "Protocol Engineer",
  },
  {
    src: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80",
    alt: "Research Developer",
  },
]

/**
 * Props for {@link AuthShell}.
 */
export interface AuthShellProps {
  /** Card title displayed below the circular Haggles emblem. */
  title: string
  /** Subtitle or description displayed beneath the title. */
  subtitle?: React.ReactNode
  /** Optional eyebrow pill rendered above the title. */
  badge?: string
  /** Max-width utility class for the frosted glass card (defaults to `max-w-md`). */
  maxWidthClassName?: string
  /** Back link target and label in the top bar. */
  backHref?: string
  /** Label for the back link in the top bar. */
  backLabel?: string
  /** Card body content. */
  children: React.ReactNode
}

/**
 * Full-viewport frosted glass authentication and onboarding layout shell.
 *
 * @param props - {@link AuthShellProps}
 * @returns Rendered layout shell with glass card and social proof footer
 *
 * @example
 * ```tsx
 * <AuthShell title="Sign in with PayPal" subtitle="Identity, wallet funding & seller payouts">
 *   <SignInCard />
 * </AuthShell>
 * ```
 */
export function AuthShell({
  title,
  subtitle,
  badge,
  maxWidthClassName = "max-w-md",
  backHref = "/",
  backLabel = "Back to home",
  children,
}: AuthShellProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = !mounted || resolvedTheme === "dark"

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-background font-sans text-foreground selection:bg-primary/20">
      <SandboxBanner mode="sandbox" />

      {/* Subtle ambient radial lighting */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute top-1/4 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/12 blur-[120px] dark:bg-primary/18" />
        <div className="absolute right-1/4 bottom-12 h-[300px] w-[300px] rounded-full bg-primary/6 blur-[100px] dark:bg-white/[0.04]" />
      </div>

      {/* Top utility bar */}
      <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-md transition-colors hover:border-border hover:text-foreground"
        >
          <IconArrowLeft className="size-3.5" />
          <span>{backLabel}</span>
        </Link>

        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label="Toggle color theme"
          className="inline-flex size-8 items-center justify-center rounded-full border border-border/60 bg-card/60 text-muted-foreground backdrop-blur-md transition-colors hover:border-border hover:text-foreground"
        >
          {mounted ? (
            isDark ? (
              <IconSun className="size-4" />
            ) : (
              <IconMoon className="size-4" />
            )
          ) : (
            <span className="size-4" />
          )}
        </button>
      </header>

      {/* Main centered glass card */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: EASE_OUT_EXPO }}
          className={cn(
            "relative w-full rounded-3xl border border-border/80 bg-gradient-to-b from-card/95 via-card/90 to-muted/40 p-7 shadow-2xl backdrop-blur-xl sm:p-9",
            "dark:border-white/10 dark:bg-gradient-to-r dark:from-white/[0.08] dark:to-[#121212]/95",
            maxWidthClassName
          )}
        >
          {/* Top specular highlight hairline */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent dark:via-white/25"
          />

          <div className="flex flex-col items-center text-center">
            <HagglesLogo className="size-16" />

            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>

            {subtitle ? (
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground sm:text-sm">
                {subtitle}
              </p>
            ) : null}
          </div>

          <div className="mt-7 w-full">{children}</div>
        </motion.div>

        {/* Developer community & avatar stack */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.12, ease: EASE_OUT_EXPO }}
          className="relative z-10 mt-9 flex flex-col items-center text-center"
        >
          <p className="mb-3 text-xs text-muted-foreground sm:text-sm">
            Join{" "}
            <span className="font-medium text-foreground">
              builders &amp; AI agents
            </span>{" "}
            settling HTTP 402 micropayments on PayPal.
          </p>
          <div className="flex items-center -space-x-2">
            {DEVELOPER_AVATARS.map((avatar) => (
              <img
                key={avatar.src}
                src={avatar.src}
                alt={avatar.alt}
                className="size-8 rounded-full border-2 border-background object-cover shadow-xs"
              />
            ))}
          </div>
        </motion.div>
      </main>
    </div>
  )
}
