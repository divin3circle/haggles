/**
 * Reusable Haggles Portal design system components (SPEC.md section 11.1).
 *
 * Includes `<Money>`, `<CopyButton>`, `<TruncatedId>`, `<KeyReveal>`, `<StatusBadge>`,
 * `<StatCard>`, `<EmptyState>`, `<CodeTabs>`, `<SandboxBanner>`, `<PolicySummary>`,
 * and `<RelativeDate>`.
 */

"use client";

import { formatMoney, parseMoney } from "@haggles/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconKey,
} from "@tabler/icons-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Formats and displays USD money values using `@haggles/core`'s `formatMoney` with a `$` prefix
 * and tabular numerals (SPEC.md section 11.1).
 *
 * @example
 * ```tsx
 * <Money value="12.40" />
 * ```
 */
export function Money({
  value,
  className,
}: {
  value: string | bigint;
  className?: string | undefined;
}) {
  let formatted: string;
  try {
    const micros = typeof value === "bigint" ? value : parseMoney(value);
    formatted = formatMoney(micros);
  } catch {
    formatted = String(value);
  }
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      ${formatted}
    </span>
  );
}

/**
 * Copy-to-clipboard icon button with visual confirmation state (SPEC.md section 11.1).
 *
 * @example
 * ```tsx
 * <CopyButton text="pay_01J9Z3..." />
 * ```
 */
export function CopyButton({
  text,
  label = "Copy to clipboard",
  className,
}: {
  text: string;
  label?: string | undefined;
  className?: string | undefined;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={copied ? "Copied!" : label}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {copied ? (
        <IconCheck className="size-3.5 text-emerald-500" />
      ) : (
        <IconCopy className="size-3.5" />
      )}
    </button>
  );
}

/**
 * Displays a monospace ID or key prefix truncated in the middle (`pay_01J9…X4K`)
 * alongside a `<CopyButton>` (SPEC.md section 11.1).
 *
 * @example
 * ```tsx
 * <TruncatedId value="pay_01J9Z3K4M5N6P7Q8R9S0T1U2V3" />
 * ```
 */
export function TruncatedId({
  value,
  head = 8,
  tail = 4,
  className,
}: {
  value: string;
  head?: number | undefined;
  tail?: number | undefined;
  className?: string | undefined;
}) {
  const display =
    value.length > head + tail + 2
      ? `${value.slice(0, head)}…${value.slice(-tail)}`
      : value;

  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-xs", className)}>
      <span title={value}>{display}</span>
      <CopyButton text={value} label={`Copy ${value}`} />
    </span>
  );
}

/**
 * Status badge following the exact colour mapping in SPEC.md section 11.1:
 * - `authorized` / `processing`: blue/secondary
 * - `captured` / `succeeded` / `credited` / `active`: green
 * - `refunded`: amber outline
 * - `released` / `revoked` / `hidden` / `paused`: muted
 * - `created` / `pending`: secondary
 * - `failed` / `reversed` / `frozen`: destructive
 * - `simulated`: dashed outline
 *
 * @example
 * ```tsx
 * <StatusBadge status="captured" />
 * ```
 */
export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string | undefined;
}) {
  const s = status.toLowerCase();
  let variantClass = "bg-secondary text-secondary-foreground border-border";

  if (s === "captured" || s === "succeeded" || s === "credited" || s === "active") {
    variantClass =
      "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400";
  } else if (s === "authorized" || s === "processing") {
    variantClass =
      "bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-400";
  } else if (s === "refunded") {
    variantClass =
      "bg-amber-500/10 text-amber-700 border-amber-500/40 dark:text-amber-400";
  } else if (s === "failed" || s === "reversed" || s === "frozen") {
    variantClass = "bg-destructive/15 text-destructive border-destructive/30";
  } else if (s === "simulated") {
    variantClass = "border-dashed border-foreground/40 text-muted-foreground bg-transparent";
  } else if (s === "released" || s === "revoked" || s === "hidden" || s === "paused") {
    variantClass = "bg-muted text-muted-foreground border-border";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize",
        variantClass,
        className,
      )}
    >
      {status}
    </span>
  );
}

/**
 * Relative timestamp for `< 24 h` ("3 min ago") with a full UTC timestamp tooltip,
 * or formatted date for older timestamps (SPEC.md section 11.1).
 *
 * @example
 * ```tsx
 * <RelativeDate iso="2026-10-06T12:00:00Z" />
 * ```
 */
export function RelativeDate({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">Never</span>;
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);

  let label: string;
  if (diffMs >= 0 && diffMin < 1) {
    label = "Just now";
  } else if (diffMs >= 0 && diffMin < 60) {
    label = `${diffMin} min ago`;
  } else if (diffMs >= 0 && diffHours < 24) {
    label = `${diffHours} hr ago`;
  } else {
    label = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <time dateTime={iso} title={date.toUTCString()} className="text-xs text-muted-foreground">
      {label}
    </time>
  );
}

/**
 * Compact policy summary string (`"≤ $0.10/call · $5.00/day"`, SPEC.md section 11.4).
 *
 * @example
 * ```tsx
 * <PolicySummary perCallMax="0.10" dailyMax="5.00" monthlyMax="50.00" />
 * ```
 */
export function PolicySummary({
  perCallMax,
  dailyMax,
  monthlyMax,
  allowedHosts,
  allowedSellers,
}: {
  perCallMax: string;
  dailyMax: string;
  monthlyMax?: string | null | undefined;
  allowedHosts?: string[] | null | undefined;
  allowedSellers?: string[] | null | undefined;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
      <span>≤ ${perCallMax}/call</span>
      <span>·</span>
      <span>${dailyMax}/day</span>
      {monthlyMax ? (
        <>
          <span>·</span>
          <span>${monthlyMax}/mo</span>
        </>
      ) : null}
      {allowedHosts && allowedHosts.length > 0 ? (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
          {allowedHosts.length} host{allowedHosts.length > 1 ? "s" : ""}
        </span>
      ) : null}
      {allowedSellers && allowedSellers.length > 0 ? (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
          {allowedSellers.length} seller{allowedSellers.length > 1 ? "s" : ""}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Metric card used across Buyer and Seller overviews and earnings views (SPEC.md section 11.1).
 *
 * @example
 * ```tsx
 * <StatCard label="Available" value={<Money value="12.40" />} footer={<Button>Add funds</Button>} />
 * ```
 */
export function StatCard({
  label,
  value,
  subtext,
  footer,
}: {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode | undefined;
  footer?: React.ReactNode | undefined;
}) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
        {subtext ? <div className="mt-1 text-xs text-muted-foreground">{subtext}</div> : null}
      </div>
      {footer ? <div className="mt-3 pt-2 border-t border-border/60">{footer}</div> : null}
    </div>
  );
}

/**
 * Empty state card with an explanation and one primary action (SPEC.md section 11.1).
 *
 * @example
 * ```tsx
 * <EmptyState title="No endpoints yet" description="Endpoints appear here after their first paid call." />
 * ```
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode | undefined;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Multi-tab code snippet viewer with copy button (SPEC.md section 11.1).
 *
 * @example
 * ```tsx
 * <CodeTabs tabs={[{ label: "Seller", code: "..." }, { label: "Buyer", code: "..." }]} />
 * ```
 */
export function CodeTabs({
  tabs,
}: {
  tabs: ReadonlyArray<{ label: string; language?: string | undefined; code: string }>;
}) {
  const [activeIdx, setActiveIdx] = React.useState(0);
  const current = tabs[activeIdx] ?? tabs[0];
  if (!current) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
        <div className="flex items-center gap-1" role="tablist">
          {tabs.map((tab, idx) => (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={idx === activeIdx}
              onClick={() => setActiveIdx(idx)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                idx === activeIdx
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CopyButton text={current.code} label={`Copy ${current.label} snippet`} />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
        <code>{current.code}</code>
      </pre>
    </div>
  );
}

/**
 * Slim amber bar displayed at the top of every page when `PAYPAL_MODE=sandbox` or `mock` (SPEC.md section 11.1).
 *
 * @example
 * ```tsx
 * <SandboxBanner mode="sandbox" />
 * ```
 */
export function SandboxBanner({ mode = "sandbox" }: { mode?: string | undefined }) {
  if (mode === "live") return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300"
    >
      <IconAlertTriangle className="size-3.5 shrink-0" />
      <span>Sandbox mode — no real money moves.</span>
    </div>
  );
}

/**
 * Show-once modal dialog for newly issued agent or seller secret keys (`SPEC.md` sections 11.1 and 11.4).
 *
 * Requires checking `"I've stored this key"` before closing.
 *
 * @example
 * ```tsx
 * <KeyReveal open={true} envVarName="HAGGLES_KEY" fullKey="hgk_test_..." onClose={() => {}} />
 * ```
 */
export function KeyReveal({
  open,
  title = "Save your secret key",
  envVarName = "HAGGLES_KEY",
  fullKey,
  onClose,
}: {
  open: boolean;
  title?: string | undefined;
  envVarName?: string | undefined;
  fullKey: string | null;
  onClose: () => void;
}) {
  const [confirmed, setConfirmed] = React.useState(false);

  React.useEffect(() => {
    if (open) setConfirmed(false);
  }, [open]);

  if (!open || !fullKey) return null;

  const envSnippet = `${envVarName}=${fullKey}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="key-reveal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg">
        <div className="flex items-center gap-2">
          <IconKey className="size-5 text-primary" />
          <h2 id="key-reveal-title" className="text-base font-semibold">
            {title}
          </h2>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          This secret key is shown only once. Haggles stores only an HMAC-SHA256 hash and cannot recover it later.
        </p>

        <div className="mt-4">
          <div className="text-xs font-medium text-muted-foreground">Secret key</div>
          <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs break-all">
            <span>{fullKey}</span>
            <CopyButton text={fullKey} label="Copy secret key" />
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs font-medium text-muted-foreground">.env snippet</div>
          <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs break-all">
            <span>{envSnippet}</span>
            <CopyButton text={envSnippet} label="Copy .env snippet" />
          </div>
        </div>

        <label className="mt-5 flex cursor-pointer items-center gap-2 text-xs font-medium select-none">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="size-4 rounded border-border accent-primary"
          />
          <span>I&apos;ve stored this key in a safe place</span>
        </label>

        <div className="mt-5 flex justify-end">
          <Button
            variant="default"
            size="lg"
            disabled={!confirmed}
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
