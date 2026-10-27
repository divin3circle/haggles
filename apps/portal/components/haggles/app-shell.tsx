/**
 * Haggles Portal App Shell (`SPEC.md` section 11.2).
 *
 * Renders the top `<SandboxBanner>`, collapsible desktop sidebar (`md+`, persisted in
 * `localStorage` + `Cmd/Ctrl + B` shortcut) and mobile drawer with BUY and SELL sections
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
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
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
import { HagglesLogo, Money, SandboxBanner } from "./primitives";

const SIDEBAR_STORAGE_KEY = "haggles.sidebar.collapsed.v1";

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
  const [collapsed, setCollapsed] = React.useState(false);
  const [account, setAccount] = React.useState<PortalAccountProfile | null>(null);
  const [availableBalance, setAvailableBalance] = React.useState<string>("0.00");

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved === "1") {
        setCollapsed(true);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleCollapsed]);

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

  const renderSidebarContent = (isCompact: boolean) => (
    <div className="flex h-full flex-col justify-between">
      <div className={cn("space-y-6", isCompact ? "px-2 py-4" : "p-4")}>
        <div
          className={cn(
            "flex items-center",
            isCompact ? "justify-center" : "justify-between px-2",
          )}
        >
          <Link
            href="/"
            title="Haggles Home"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-sidebar-foreground"
          >
            <HagglesLogo className="size-6 shrink-0" />
            {!isCompact ? <span>Haggles</span> : null}
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
          {isCompact ? (
            <div
              aria-hidden="true"
              className="mx-2 mb-2 h-px bg-sidebar-border"
            />
          ) : (
            <div className="px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Buy
            </div>
          )}
          {isBuyer ? (
            <nav aria-label="Buy navigation" className="mt-1.5 space-y-0.5">
              {BUY_NAV.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={isCompact ? `Buy · ${item.label}` : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center rounded-md text-xs font-medium transition-colors",
                      isCompact
                        ? "justify-center p-2"
                        : "gap-2.5 px-2.5 py-1.5",
                      active
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!isCompact ? <span>{item.label}</span> : null}
                  </Link>
                );
              })}
            </nav>
          ) : !isCompact ? (
            <div className="mt-1.5 px-2">
              <Link
                href="/account"
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Enable buying →
              </Link>
            </div>
          ) : null}
        </div>

        {/* SELL section */}
        <div>
          {isCompact ? (
            <div
              aria-hidden="true"
              className="mx-2 mb-2 h-px bg-sidebar-border"
            />
          ) : (
            <div className="px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Sell
            </div>
          )}
          {isSeller ? (
            <nav aria-label="Sell navigation" className="mt-1.5 space-y-0.5">
              {SELL_NAV.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={isCompact ? `Sell · ${item.label}` : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center rounded-md text-xs font-medium transition-colors",
                      isCompact
                        ? "justify-center p-2"
                        : "gap-2.5 px-2.5 py-1.5",
                      active
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!isCompact ? <span>{item.label}</span> : null}
                  </Link>
                );
              })}
            </nav>
          ) : !isCompact ? (
            <div className="mt-1.5 px-2">
              <Link
                href="/account"
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Enable selling →
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      {/* Bottom links */}
      <div
        className={cn(
          "space-y-1 border-t border-sidebar-border",
          isCompact ? "px-2 py-3" : "p-4",
        )}
      >
        <a
          href={process.env.NEXT_PUBLIC_DOCS_URL ?? "https://github.com/haggles/haggles"}
          target="_blank"
          rel="noreferrer"
          title={isCompact ? "Docs" : undefined}
          className={cn(
            "flex items-center rounded-md text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            isCompact ? "justify-center p-2" : "justify-between px-2.5 py-1.5",
          )}
        >
          {!isCompact ? <span>Docs</span> : null}
          <IconExternalLink className="size-4 shrink-0" />
        </a>
        <Link
          href="/account"
          title={isCompact ? "Account" : undefined}
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center rounded-md text-xs font-medium transition-colors",
            isCompact ? "justify-center p-2" : "gap-2.5 px-2.5 py-1.5",
            pathname === "/account"
              ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <IconUser className="size-4 shrink-0" />
          {!isCompact ? <span>Account</span> : null}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SandboxBanner mode={account?.environment.paypal_mode ?? "sandbox"} />

      <div className="flex flex-1">
        {/* Desktop Collapsible Sidebar (md+) */}
        <aside
          className={cn(
            "hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:block",
            collapsed ? "w-15" : "w-56",
          )}
        >
          {renderSidebarContent(collapsed)}
        </aside>

        {/* Mobile Sheet Sidebar (< md) */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="relative z-10 w-64 border-r border-sidebar-border bg-sidebar">
              {renderSidebarContent(false)}
            </aside>
          </div>
        ) : null}

        {/* Main Column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="flex h-13 items-center justify-between border-b border-border bg-card/50 px-4 md:px-6">
            <div className="flex items-center gap-2.5">
              {/* Mobile menu trigger */}
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
              >
                <IconMenu2 className="size-4" />
              </button>

              {/* Desktop sidebar collapse/expand trigger (md+) */}
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={
                  collapsed
                    ? "Expand sidebar (⌘B)"
                    : "Collapse sidebar (⌘B)"
                }
                className="hidden cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
              >
                {collapsed ? (
                  <IconLayoutSidebarLeftExpand className="size-4" />
                ) : (
                  <IconLayoutSidebarLeftCollapse className="size-4" />
                )}
              </button>

              <span
                aria-hidden="true"
                className="hidden h-4 w-px bg-border md:inline-block"
              />

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
