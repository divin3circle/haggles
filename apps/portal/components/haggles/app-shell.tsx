/**
 * Haggles Portal App Shell (`SPEC.md` section 11.2).
 *
 * Renders the top `<SandboxBanner>`, responsive sidebar with BUY and SELL sections
 * (showing "Enable buying / selling" when a role is disabled), breadcrumb header,
 * buyer wallet balance pill, theme toggle, and account menu.
 */

"use client";

import {
  IconActivity,
  IconApi,
  IconChecklist,
  IconCoin,
  IconCreditCard,
  IconExternalLink,
  IconKey,
  IconLayoutDashboard,
  IconMenu2,
  IconMoon,
  IconSun,
  IconUser,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  type PortalAccountProfile,
  portalApi,
} from "@/lib/portal-api";
import { cn } from "@/lib/utils";
import { Money, SandboxBanner } from "./primitives";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const BUY_NAV: NavItem[] = [
  { label: "Overview", href: "/buy", icon: IconLayoutDashboard },
  { label: "Wallet", href: "/buy/wallet", icon: IconWallet },
  { label: "Agent keys", href: "/buy/keys", icon: IconKey },
  { label: "Payments", href: "/buy/payments", icon: IconCreditCard },
];

const SELL_NAV: NavItem[] = [
  { label: "Overview", href: "/sell", icon: IconLayoutDashboard },
  { label: "Setup", href: "/sell/setup", icon: IconChecklist },
  { label: "Endpoints", href: "/sell/endpoints", icon: IconApi },
  { label: "Calls", href: "/sell/calls", icon: IconActivity },
  { label: "Earnings", href: "/sell/earnings", icon: IconCoin },
  { label: "Seller keys", href: "/sell/keys", icon: IconKey },
];

/**
 * Authenticated Portal App Shell (`SPEC.md` section 11.2).
 *
 * @example
 * ```tsx
 * <AppShell title="Buy Overview">{children}</AppShell>
 * ```
 */
export function AppShell({
  title,
  description,
  actions,
  section,
  children,
}: {
  title: string;
  description?: string | undefined;
  actions?: React.ReactNode | undefined;
  section?: "Buy" | "Sell" | "Account" | undefined;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [account, setAccount] = React.useState<PortalAccountProfile | null>(null);
  const [availableBalance, setAvailableBalance] = React.useState<string>("12.40");

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      const me = await portalApi.getMe();
      if (!mounted) return;
      setAccount(me);
      if (me.is_buyer) {
        const summary = await portalApi.getBuyerSummary();
        if (mounted) setAvailableBalance(summary.available);
      }
    };
    void load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [pathname]);

  const isBuyer = account?.is_buyer ?? true;
  const isSeller = account?.is_seller ?? true;

  const isActive = (href: string) => {
    if (href === "/buy" || href === "/sell") {
      return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col justify-between">
      <div className="space-y-6 p-4">
        <div className="flex items-center justify-between px-2">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-sidebar-foreground"
          >
            <span className="inline-flex size-5 items-center justify-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
              ◆
            </span>
            <span>Haggles</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="rounded p-1 text-muted-foreground hover:text-foreground md:hidden"
          >
            <IconX className="size-4" />
          </button>
        </div>

        {/* BUY section */}
        <div>
          <div className="px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Buy
          </div>
          {isBuyer ? (
            <nav aria-label="Buy navigation" className="mt-1.5 space-y-0.5">
              {BUY_NAV.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          ) : (
            <div className="mt-1.5 px-2">
              <Link
                href="/account"
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Enable buying →
              </Link>
            </div>
          )}
        </div>

        {/* SELL section */}
        <div>
          <div className="px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Sell
          </div>
          {isSeller ? (
            <nav aria-label="Sell navigation" className="mt-1.5 space-y-0.5">
              {SELL_NAV.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          ) : (
            <div className="mt-1.5 px-2">
              <Link
                href="/account"
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Enable selling →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Bottom links */}
      <div className="border-t border-sidebar-border p-4 space-y-1">
        <a
          href={process.env.NEXT_PUBLIC_DOCS_URL ?? "https://github.com/haggles/haggles"}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
        >
          <span>Docs</span>
          <IconExternalLink className="size-3.5" />
        </a>
        <Link
          href="/account"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            pathname === "/account"
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <IconUser className="size-4 shrink-0" />
          <span>Account</span>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SandboxBanner mode={account?.environment.paypal_mode ?? "sandbox"} />

      <div className="flex flex-1">
        {/* Desktop Sidebar */}
        <aside className="hidden w-56 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
          {renderSidebarContent()}
        </aside>

        {/* Mobile Sheet Sidebar */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="relative z-10 w-64 border-r border-sidebar-border bg-sidebar">
              {renderSidebarContent()}
            </aside>
          </div>
        ) : null}

        {/* Main Column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="flex h-13 items-center justify-between border-b border-border bg-card/50 px-4 md:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
              >
                <IconMenu2 className="size-4" />
              </button>
              <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs">
                {section ? (
                  <>
                    <span className="text-muted-foreground">{section}</span>
                    <span className="text-muted-foreground">/</span>
                  </>
                ) : null}
                <span className="font-semibold text-foreground">{title}</span>
              </nav>
            </div>

            <div className="flex items-center gap-2.5">
              {isBuyer ? (
                <Link
                  href="/buy/wallet"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium transition-colors hover:bg-muted"
                >
                  <Money value={availableBalance} className="font-semibold text-foreground" />
                  <span className="text-muted-foreground">available</span>
                </Link>
              ) : null}

              <Button
                variant="ghost"
                size="icon"
                aria-label="Toggle color theme"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              >
                {resolvedTheme === "dark" ? (
                  <IconSun className="size-4" />
                ) : (
                  <IconMoon className="size-4" />
                )}
              </Button>

              <Link
                href="/account"
                title={account?.email ?? "Account"}
                className="inline-flex size-7 items-center justify-center rounded-full border border-border bg-primary/10 text-xs font-semibold text-primary"
              >
                {(account?.display_name ?? account?.email ?? "A").slice(0, 1).toUpperCase()}
              </Link>
            </div>
          </header>

          {/* Page Content */}
          <main className="flex-1 p-4 md:p-6 lg:p-8">
            <div className="mx-auto max-w-6xl space-y-6">
              {description || actions ? (
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
                    {description ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                    ) : null}
                  </div>
                  {actions ? <div className="shrink-0">{actions}</div> : null}
                </div>
              ) : null}
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
