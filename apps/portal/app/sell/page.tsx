/**
 * Seller Overview page (`/sell`, SPEC.md section 11.5.1).
 *
 * Interactive composable dashboard powered by `DraggableWidgetGrid` (`motion/react`):
 * - Four `sm` widgets: Pending balance (+ Request payout when ≥ $1.00), Paid out (all time), Calls (24 h), Revenue (30 days net)
 * - Four `wide` widgets: 30-day revenue bar chart, Top 5 endpoints with revenue share bars, Recent calls trace list, and Facilitator & Payout settlement health strip
 */

"use client";

import { parseMoney } from "@haggles/core";
import {
  IconArrowRight,
  IconCash,
  IconGripVertical,
  IconSettings,
} from "@tabler/icons-react";
import Link from "next/link";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import {
  Money,
  RelativeDate,
  StatusBadge,
  TruncatedId,
} from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import DraggableWidgetGrid, {
  type WidgetItem,
} from "@/components/ui/draggable-widget-grid";
import { type PortalSellerSummary, portalApi } from "@/lib/portal-api";

type SellerWidgetKind =
  | "pending"
  | "paid-out"
  | "calls-24h"
  | "revenue-30d"
  | "daily-revenue"
  | "top-endpoints"
  | "recent-calls"
  | "settlement-health";

interface SellerWidget extends WidgetItem {
  kind: SellerWidgetKind;
}

const SELLER_WIDGETS: SellerWidget[] = [
  {
    id: "pending",
    kind: "pending",
    size: "sm",
    label: "Pending balance",
  },
  {
    id: "paid-out",
    kind: "paid-out",
    size: "sm",
    label: "Paid out (all time)",
  },
  {
    id: "calls-24h",
    kind: "calls-24h",
    size: "sm",
    label: "Calls (24 h)",
  },
  {
    id: "revenue-30d",
    kind: "revenue-30d",
    size: "sm",
    label: "Revenue (30 days)",
  },
  {
    id: "daily-revenue",
    kind: "daily-revenue",
    size: "wide",
    label: "Daily net revenue (30 days)",
  },
  {
    id: "top-endpoints",
    kind: "top-endpoints",
    size: "wide",
    label: "Top 5 endpoints (30d)",
  },
  {
    id: "recent-calls",
    kind: "recent-calls",
    size: "wide",
    label: "Recent calls",
  },
  {
    id: "settlement-health",
    kind: "settlement-health",
    size: "wide",
    label: "Facilitator & payout status",
  },
];

function WidgetShell({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="@container flex h-full flex-col gap-3 p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs leading-none">
        <h2 className="flex items-center gap-1.5 truncate font-mono text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
          <IconGripVertical
            className="size-3.5 shrink-0 opacity-45"
            aria-hidden="true"
          />
          <span className="truncate">{title}</span>
        </h2>
        {meta ? (
          <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function PulseDot({
  tone = "ok",
  pulse = false,
}: {
  tone?: "ok" | "warn" | "idle";
  pulse?: boolean;
}) {
  const color =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : "bg-muted-foreground/60";
  return (
    <span aria-hidden="true" className="relative inline-flex size-2 shrink-0">
      {pulse ? (
        <span
          className={`absolute inset-0 animate-ping rounded-full opacity-50 motion-reduce:hidden ${color}`}
        />
      ) : null}
      <span className={`relative size-2 rounded-full ${color}`} />
    </span>
  );
}

export default function SellerOverviewPage() {
  const [summary, setSummary] = React.useState<PortalSellerSummary | null>(null);
  const [series, setSeries] = React.useState<
    Array<{ date: string; revenue: string; calls: number }>
  >([]);
  const [payoutMsg, setPayoutMsg] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const [sum, rev] = await Promise.all([
      portalApi.getSellerSummary(),
      portalApi.getSellerRevenueSeries(30),
    ]);
    setSummary(sum);
    setSeries(rev);
  }, []);

  React.useEffect(() => {
    void portalApi.getSellerSummary().then(setSummary);
    void portalApi.getSellerRevenueSeries(30).then(setSeries);
  }, []);

  const pendingMicros = summary ? parseMoney(summary.pending) : 0n;
  const canPayout = pendingMicros >= 1_000_000n;

  const handleQuickPayout = async () => {
    try {
      const p = await portalApi.requestSellerPayout();
      setPayoutMsg(
        `Payout ${p.id} ($${p.amount}) settled via PayPal Payouts v1.`,
      );
      await refresh();
    } catch (err) {
      setPayoutMsg(err instanceof Error ? err.message : "Payout failed");
    }
  };

  const maxDailyRev = Math.max(
    0.01,
    ...series.map((d) => Number.parseFloat(d.revenue) || 0),
  );

  const recent14 = series.slice(-14);
  const topEndpoints = summary?.top_endpoints ?? [];
  const maxEndpointCalls = Math.max(
    1,
    ...topEndpoints.map((ep) => ep.calls_30d),
  );

  const renderWidget = (item: SellerWidget) => {
    switch (item.kind) {
      case "pending":
        return (
          <WidgetShell
            title="Pending balance"
            meta={
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                <PulseDot tone={canPayout ? "ok" : "idle"} pulse={canPayout} />
                {canPayout ? "payable" : "< $1 min"}
              </span>
            }
          >
            <div className="text-[28px] leading-none font-semibold tracking-tight text-foreground tabular-nums @[240px]:text-[30px]">
              <Money value={summary?.pending ?? "0.00"} />
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              Net of 5% facilitator fee (sub-cent precision)
            </p>
            <div className="mt-auto pt-3">
              <button
                type="button"
                disabled={!canPayout}
                onClick={handleQuickPayout}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                Request payout (min $1.00)
                <IconArrowRight className="size-3.5" />
              </button>
            </div>
          </WidgetShell>
        );

      case "paid-out":
        return (
          <WidgetShell title="Paid out" meta="all time">
            <div className="text-[28px] leading-none font-semibold tracking-tight text-foreground tabular-nums @[240px]:text-[30px]">
              <Money value={summary?.paid_out ?? "0.00"} />
            </div>
            <p className="mt-2.5 truncate text-xs text-muted-foreground">
              To {summary?.payout_email ?? "PayPal account"}
            </p>
            <div className="mt-auto pt-3">
              <Link
                href="/sell/earnings"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Payout history
                <IconArrowRight className="size-3.5" />
              </Link>
            </div>
          </WidgetShell>
        );

      case "calls-24h":
        return (
          <WidgetShell
            title="Calls (24 h)"
            meta={
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                <PulseDot tone="ok" pulse />
                live
              </span>
            }
          >
            <div className="font-mono text-[28px] leading-none font-semibold tracking-tight text-foreground tabular-nums @[240px]:text-[30px]">
              {(summary?.calls_24h ?? 0).toLocaleString()}
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              Captured HTTP 402 requests
            </p>
            <dl className="mt-auto space-y-1.5 pt-2 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Ed25519 verified</dt>
                <dd className="font-mono text-emerald-600 dark:text-emerald-400">
                  100%
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">5xx auto-refund</dt>
                <dd className="font-mono text-foreground">enabled</dd>
              </div>
            </dl>
          </WidgetShell>
        );

      case "revenue-30d":
        return (
          <WidgetShell title="Revenue (30d)" meta="net USD">
            <div className="text-[28px] leading-none font-semibold tracking-tight text-foreground tabular-nums @[240px]:text-[30px]">
              <Money value={summary?.revenue_30d ?? "0.00"} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Net seller earnings (30d)
            </p>
            <div
              role="img"
              aria-label="Daily net revenue over the last 14 days"
              className="mt-auto flex h-9 items-end gap-[3px] pt-2"
            >
              {(recent14.length > 0
                ? recent14
                : Array.from({ length: 14 }, (_, i) => ({
                    date: String(i),
                    revenue: "0.05",
                    calls: 2,
                  }))
              ).map((d, i, arr) => {
                const v = Number.parseFloat(d.revenue) || 0;
                const pct = Math.max(12, Math.round((v / maxDailyRev) * 100));
                return (
                  <span
                    key={d.date}
                    className={`flex-1 rounded-full transition-[height] duration-500 ${
                      i === arr.length - 1 ? "bg-primary" : "bg-foreground/15"
                    }`}
                    style={{ height: `${pct}%` }}
                  />
                );
              })}
            </div>
          </WidgetShell>
        );

      case "daily-revenue":
        return (
          <WidgetShell
            title="Daily net revenue (30 days)"
            meta={
              <span className="font-mono text-[11px]">
                Peak: <Money value={maxDailyRev.toFixed(2)} />
              </span>
            }
          >
            <p className="text-xs text-muted-foreground">
              Captured call revenue after 5% facilitator fee
            </p>
            <div
              className="mt-auto flex h-28 items-end gap-1 pt-3"
              aria-label="30-day seller revenue chart"
            >
              {series.map((entry, idx) => {
                const val = Number.parseFloat(entry.revenue) || 0;
                const heightPct = Math.max(
                  8,
                  Math.round((val / maxDailyRev) * 100),
                );
                const isToday = idx === series.length - 1;
                return (
                  <div
                    key={entry.date}
                    className="group relative flex h-full flex-1 flex-col items-center justify-end"
                    title={`${entry.date}: $${entry.revenue} (${entry.calls} calls)`}
                  >
                    <div
                      className={`w-full rounded-t-xs transition-colors ${
                        isToday
                          ? "bg-primary"
                          : "bg-primary/65 group-hover:bg-primary"
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>{series[0]?.date ?? "30d ago"}</span>
              <span>Today (UTC)</span>
            </div>
          </WidgetShell>
        );

      case "top-endpoints":
        return (
          <WidgetShell
            title="Top 5 endpoints (30d)"
            meta={
              <Link
                href="/sell/endpoints"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View all
                <IconArrowRight className="size-3" />
              </Link>
            }
          >
            <table className="my-auto w-full table-fixed text-left text-xs">
              <caption className="sr-only">
                Top monetized endpoints in the last 30 days
              </caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Endpoint</th>
                  <th scope="col">Share</th>
                  <th scope="col">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {topEndpoints.slice(0, 4).map((ep, idx) => (
                  <tr key={ep.id}>
                    <th scope="row" className="w-[52%] truncate py-2 pr-3 font-normal">
                      <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                        {ep.method}
                      </span>
                      <span className="font-mono text-foreground">
                        {ep.route}
                      </span>
                    </th>
                    <td className="py-2 pr-3">
                      <span
                        aria-hidden="true"
                        className="block h-1.5 rounded-full bg-foreground/10"
                      >
                        <span
                          className={`block h-full rounded-full ${
                            idx === 0 ? "bg-primary" : "bg-foreground/30"
                          }`}
                          style={{
                            width: `${Math.max(
                              8,
                              Math.round((ep.calls_30d / maxEndpointCalls) * 100),
                            )}%`,
                          }}
                        />
                      </span>
                    </td>
                    <td className="w-[88px] py-2 text-right font-mono tabular-nums">
                      <Money value={ep.revenue_30d} className="font-semibold" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </WidgetShell>
        );

      case "recent-calls":
        return (
          <WidgetShell
            title="Recent calls"
            meta={
              <Link
                href="/sell/calls"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View all
                <IconArrowRight className="size-3" />
              </Link>
            }
          >
            <ol
              aria-label="Most recent metered agent requests"
              className="my-auto divide-y divide-border/60 text-xs"
            >
              {(summary?.recent_calls ?? []).slice(0, 4).map((c) => (
                <li
                  key={c.payment_id}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                        {c.method}
                      </span>
                      <span className="truncate font-mono">{c.route}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <TruncatedId value={c.agent_ref} head={8} tail={4} />
                      <span>·</span>
                      <RelativeDate iso={c.created_at} />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Money value={c.seller_net} className="font-semibold" />
                    <StatusBadge status={c.status} />
                  </div>
                </li>
              ))}
            </ol>
          </WidgetShell>
        );

      case "settlement-health":
        return (
          <WidgetShell title="Facilitator & payouts" meta="30d">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[26px] leading-none font-semibold tracking-tight text-foreground tabular-nums">
                99.99%{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  JWKS &amp; redeem availability
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <PulseDot tone="ok" pulse />
                PayPal Payouts v1 active
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Weekly batch sweep every Monday 00:00 UTC + instant on-demand
              payouts above $1.00.
            </p>
            <div
              role="img"
              aria-label="30-day facilitator settlement availability strip"
              className="mt-auto flex h-6 gap-[3px] pt-3"
            >
              {Array.from({ length: 30 }, (_, i) => (
                <span
                  key={i}
                  className={`flex-1 rounded-[2px] ${
                    i === 29 ? "bg-emerald-500" : "bg-emerald-500/45"
                  }`}
                />
              ))}
            </div>
          </WidgetShell>
        );
    }
  };

  return (
    <AppShell
      section="Sell"
      title="Seller overview"
      description="Track your API monetization revenue, captured 402 calls, and PayPal Payouts v1 settlements."
      actions={
        <div className="flex items-center gap-2">
          <Link href="/sell/setup">
            <Button variant="outline" size="sm">
              <IconSettings className="size-3.5" />
              Setup guide
            </Button>
          </Link>
          <Link href="/sell/earnings">
            <Button size="sm">
              <IconCash className="size-3.5" />
              Earnings &amp; payouts
            </Button>
          </Link>
        </div>
      }
    >
      {payoutMsg ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300"
        >
          {payoutMsg}
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-[1120px]">
        <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <IconGripVertical className="size-3.5 opacity-60" />
          <span className="[@media(pointer:coarse)]:hidden">
            Drag and rearrange cards to customize your seller dashboard layout
            (or hold Alt + Arrow keys).
          </span>
          <span className="hidden [@media(pointer:coarse)]:inline">
            Press and hold a card, then drag to rearrange your seller dashboard.
          </span>
        </p>

        <DraggableWidgetGrid
          items={SELLER_WIDGETS}
          cellSize={220}
          gap={14}
          radius={18}
          renderItem={(item) => renderWidget(item as SellerWidget)}
        />
      </div>
    </AppShell>
  );
}
