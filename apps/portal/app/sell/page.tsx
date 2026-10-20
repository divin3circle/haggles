/**
 * Seller Overview page (`/sell`, SPEC.md section 11.5.1).
 *
 * Displays:
 * - Four `<StatCard>`s: Pending balance (+ Request payout when ≥ $1.00), Paid out (all time), Calls (24 h), Revenue (30 days net)
 * - 30-day revenue bar chart
 * - Two-column row: Top 5 endpoints by 30-day revenue + Recent 10 calls
 */

"use client";

import { parseMoney } from "@haggles/core";
import { IconArrowRight, IconCash, IconSettings } from "@tabler/icons-react";
import Link from "next/link";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import {
  Money,
  RelativeDate,
  StatCard,
  StatusBadge,
  TruncatedId,
} from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import { type PortalSellerSummary, portalApi } from "@/lib/portal-api";

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
    void refresh();
  }, [refresh]);

  const pendingMicros = summary ? parseMoney(summary.pending) : 0n;
  const canPayout = pendingMicros >= 1_000_000n;

  const handleQuickPayout = async () => {
    try {
      const p = await portalApi.requestSellerPayout();
      setPayoutMsg(`Payout ${p.id} ($${p.amount}) settled via PayPal Payouts v1.`);
      await refresh();
    } catch (err) {
      setPayoutMsg(err instanceof Error ? err.message : "Payout failed");
    }
  };

  const maxDailyRev = Math.max(
    0.01,
    ...series.map((d) => Number.parseFloat(d.revenue) || 0),
  );

  return (
    <AppShell
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
          className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300"
        >
          {payoutMsg}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pending balance"
          value={<Money value={summary?.pending ?? "0.00"} />}
          subtext="Net of 5% facilitator fee"
          footer={
            <button
              type="button"
              disabled={!canPayout}
              onClick={handleQuickPayout}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              Request payout (min $1.00)
              <IconArrowRight className="size-3" />
            </button>
          }
        />

        <StatCard
          label="Paid out (all time)"
          value={<Money value={summary?.paid_out ?? "0.00"} />}
          subtext={`To ${summary?.payout_email ?? "PayPal account"}`}
        />

        <StatCard
          label="Calls (24 h)"
          value={
            <span className="font-mono tabular-nums">
              {(summary?.calls_24h ?? 0).toLocaleString()}
            </span>
          }
          subtext="Captured HTTP 402 requests"
        />

        <StatCard
          label="Revenue (30 days)"
          value={<Money value={summary?.revenue_30d ?? "0.00"} />}
          subtext="Net seller earnings (30d)"
        />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Daily net revenue (30 days)</h2>
            <p className="text-xs text-muted-foreground">
              Captured call revenue after 5% facilitator fee
            </p>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            Peak: <Money value={maxDailyRev.toFixed(2)} />
          </span>
        </div>

        <div
          className="mt-6 flex h-40 items-end gap-1 pt-4"
          aria-label="30-day seller revenue chart"
        >
          {series.map((item) => {
            const val = Number.parseFloat(item.revenue) || 0;
            const heightPct = Math.max(6, Math.round((val / maxDailyRev) * 100));
            return (
              <div
                key={item.date}
                className="group relative flex h-full flex-1 flex-col items-center justify-end"
                title={`${item.date}: $${item.revenue} (${item.calls} calls)`}
              >
                <div
                  className="w-full rounded-t-xs bg-primary/75 transition-colors group-hover:bg-primary"
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
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Top 5 endpoints (30d)</h2>
              <p className="text-xs text-muted-foreground">
                Auto-registered on first captured call
              </p>
            </div>
            <Link
              href="/sell/endpoints"
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>

          <div className="mt-4 divide-y divide-border">
            {(summary?.top_endpoints ?? []).map((ep) => (
              <div
                key={ep.id}
                className="flex items-center justify-between gap-2 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                      {ep.method}
                    </span>
                    <span className="truncate font-mono">{ep.route}</span>
                  </div>
                  {ep.display_name ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {ep.display_name}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3 font-mono">
                  <span className="text-muted-foreground">
                    {ep.calls_30d.toLocaleString()} calls
                  </span>
                  <Money value={ep.revenue_30d} className="font-semibold" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Recent calls</h2>
              <p className="text-xs text-muted-foreground">
                Last 10 metered agent requests
              </p>
            </div>
            <Link
              href="/sell/calls"
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>

          <div className="mt-4 divide-y divide-border">
            {(summary?.recent_calls ?? []).slice(0, 10).map((c) => (
              <div
                key={c.payment_id}
                className="flex items-center justify-between gap-2 py-2.5 text-xs"
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
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
