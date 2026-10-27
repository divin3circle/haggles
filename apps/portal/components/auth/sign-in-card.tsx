/**
 * Modern frosted-glass Sign-In card content for `/login` (`SPEC.md` section 11.3).
 *
 * Adapted from the `modern-stunning-sign-in` design pattern for Haggles' passwordless
 * Log in with PayPal (OpenID Connect) flow and instant Sandbox Demo Account preview.
 */

"use client"

import {
  IconArrowRight,
  IconBrandPaypal,
  IconPlayerPlay,
} from "@tabler/icons-react"
import Image from "next/image"
import Link from "next/link"
import * as React from "react"
import { haloToast } from "@/components/ui/halo-toast"

/**
 * Interactive sign-in card body for `/login`.
 *
 * @returns Sign-in controls for PayPal Sandbox OIDC and Demo Account entry
 *
 * @example
 * ```tsx
 * <SignInCard />
 * ```
 */
export function SignInCard() {
  const [loadingPayPal, setLoadingPayPal] = React.useState(false)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const errParam = params.get("error")
    const expiredParam = params.get("expired")
    if (expiredParam) {
      const msg = "Your PayPal session has expired. Please sign in again."
      setError(msg)
      haloToast.error("Session expired", msg)
      window.history.replaceState({}, "", "/login")
    } else if (errParam) {
      setError(errParam)
      haloToast.error("PayPal sign-in failed", errParam)
    }
  }, [])

  const handlePayPalLogin = async () => {
    setError("")
    setLoadingPayPal(true)
    if (typeof window !== "undefined") {
      window.localStorage.setItem("haggles_auth_mode", "paypal")
    }
    try {
      const res = await fetch("/portal/v1/auth/paypal/start", {
        headers: { accept: "application/json" },
        credentials: "include",
      })
      if (res.ok) {
        const data = (await res.json()) as { authorize_url?: string }
        if (data.authorize_url && !data.authorize_url.includes("client_id=&")) {
          window.location.href = data.authorize_url
          return
        }
        throw new Error("Invalid PayPal authorization URL returned by server.")
      }
      const errBody = (await res.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null
      const msg = errBody?.error?.message ?? errBody?.message ?? `Sign-in request failed with status ${res.status}`
      setError(msg)
      haloToast.error("Sign-in failed", msg)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to connect to PayPal"
      setError(msg)
      haloToast.error("Sign-in error", msg)
    } finally {
      setLoadingPayPal(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-5">
      {/* Capability highlights (replaces email/password inputs with passwordless OIDC context) */}
      <div className="flex flex-col gap-2.5">
        {/* {CAPABILITY_PILLS.map((item) => { */}
        {/*   const Icon = item.icon */}
        {/*   return ( */}
        {/*     <div */}
        {/*       key={item.title} */}
        {/*       className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-left transition-colors dark:border-white/10 dark:bg-white/[0.05]" */}
        {/*     > */}
        {/*       <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary"> */}
        {/*         <Icon className="size-4" /> */}
        {/*       </span> */}
        {/*       <div className="min-w-0"> */}
        {/*         <div className="text-xs font-semibold text-foreground"> */}
        {/*           {item.title} */}
        {/*         </div> */}
        {/*         <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground"> */}
        {/*           {item.detail} */}
        {/*         </p> */}
        {/*       </div> */}
        {/*     </div> */}
        {/*   ) */}
        {/* })} */}
        <div className="flex w-full items-center justify-center">
          <Image
            src={"/signin2.png"}
            height={500}
            width={500}
            alt="sigin"
            className="size-44"
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2 text-left text-xs text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      <hr className="border-border/60 dark:border-white/10" />

      {/* Action buttons */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={handlePayPalLogin}
          disabled={loadingPayPal}
          className="group relative flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-primary px-5 py-3.5 text-sm font-medium text-primary-foreground shadow-lg transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <IconBrandPaypal className="size-4.5" />
          <span>
            {loadingPayPal
              ? "Connecting to PayPal Sandbox…"
              : "Continue with PayPal Sandbox"}
          </span>
          <IconArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </button>

        <Link
          href="/buy"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.localStorage.setItem("haggles_auth_mode", "demo")
            }
          }}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-border/80 bg-secondary/70 px-5 py-3 text-sm font-medium text-foreground shadow-xs transition-all hover:bg-secondary dark:border-white/12 dark:bg-gradient-to-b dark:from-[#232526] dark:to-[#2d2e30] dark:text-white dark:hover:brightness-110"
        >
          <IconPlayerPlay className="size-4 text-primary dark:text-white/85" />
          <span>Enter Sandbox Demo Account</span>
        </Link>
      </div>

      {/* OIDC scope & environment footer */}
      {/* <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-2.5 text-center text-[11px] leading-relaxed text-muted-foreground dark:border-white/8 dark:bg-white/[0.03]"> */}
      {/*   <span className="font-medium text-foreground">Sandbox OIDC:</span>{" "} */}
      {/*   Requests{" "} */}
      {/*   <code className="rounded bg-background/70 px-1 py-0.5 text-[10px] text-foreground"> */}
      {/*     openid profile email paypalattributes */}
      {/*   </code> */}
      {/*   . No real money moves. */}
      {/* </div> */}
      {/**/}
      <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
        <span>New to Haggles?</span>
        <Link
          href="/onboarding"
          className="font-medium text-foreground underline underline-offset-4 transition-opacity hover:opacity-80"
        >
          Configure buyer / seller roles →
        </Link>
      </div>
    </div>
  )
}
