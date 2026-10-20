/**
 * Buyer Overview page (`/buy`, SPEC.md section 11.4.1).
 *
 * Displays:
 * - Four `<StatCard>`s: Available balance (+ Add funds), Held in flight, Spent today (with progress bar against smallest active key `daily_max`), and Spent 30 days
 * - Low-balance `< $1.00` warning alert with "Add funds" action
 * - Two-column row: 30-day daily spend bar chart + Recent 10 payments card
 * - Empty state checklist (`Add funds` → `Create an agent key` → `Make a paid call`) when no payments exist
 */

"use client";

import { parseMoney } from "@haggles/core";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCircleCheck,
  IconPlus,
} from "@tabler/icons-react";
import Link from "next/link";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import {
  Money,
  RelativeDate,
  StatCard,
  StatusBadge,
} from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import {
  type PortalBuyerSummary,
  portalApi,
} from "@/lib/portal-api";

export default function BuyerOverviewPage() {
  const [summary, setSummary] = React.useState<PortalBuyerSummary | null>(null);
  const [series, setSeries] = React.useState<
    Array<{ date: string; spent: string; count: number }>
  >([]);

  React.useEffect(() => {
    void portalApi.getBuyerSummary().then(setSummary);
    void portalApi.getBuyerSpendSeries(30).then(setSeries);
  }, []);

  const availableMicros = summary ? parseMoney(summary.available) : 1_000_000n;
  const isLowBalance = summary !== null && availableMicros < 1_000_000n;

  const spentTodayNum = summary ? Number(summary.spent_today) : 0;
  const dailyCapNum =
    summary?.smallest_daily_max ? Number(summary.smallest_daily_max) : 5;
  const progressPct =
    dailyCapNum > 0 ? Math.min(100, Math.round((spentTodayNum / dailyCapNum) * 100)) : 0;

  const maxDailySpend = Math.max(
    0.01,
    ...series.map((d) => Number.parseFloat(d.spent) || 0),
  );

  return (
    <AppShell
      title="Buyer overview"
      description="Monitor your prepaid agent wallet, spending velocity, and recent HTTP 402 settlements."
      actions={
        <Link href="/buy/wallet">
          <Button size="sm">
            <IconPlus className="size-3.5" />
            Add funds
          </Button>
        </Link>
      }
    >
      {isLowBalance ? (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300"
        >
          <div className="flex items-center gap-2">
            <IconAlertTriangle className="size-4 shrink-0" />
            <span>
              <strong>Low wallet balance:</strong> Available balance is below{" "}
              <span className="font-mono">$1.00</span>. Agent calls may fail with{" "}
              <code className="font-mono">insufficient_balance</code>.
            </span>
          </div>
          <Link href="/buy/wallet">
            <Button variant="outline" size="xs">
              Add funds
            </Button>
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Available"
          value={<Money value={summary?.available ?? "0.00"} />}
          subtext="Ready for immediate agent spend"
          footer={
            <Link
              href="/buy/wallet"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Add funds
              <IconArrowRight className="size-3" />
            </Link>
          }
        />

        <StatCard
          label="Held in flight"
          value={<Money value={summary?.held ?? "0.00"} />}
          subtext={`${summary?.in_flight_count ?? 0} in-flight authorization${
            (summary?.in_flight_count ?? 0) === 1 ? "" : "s"
          } (60 s TTL)`}
        />

        <StatCard
          label="Spent today (UTC)"
          value={<Money value={summary?.spent_today ?? "0.00"} />}
          subtext={
            summary?.smallest_daily_max
              ? `${progressPct}% of $${summary.smallest_daily_max}/day smallest active key cap`
              : "No active daily cap"
          }
          footer={
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          }
        />

        <StatCard
          label="Spent (30 days)"
          value={<Money value={summary?.spent_30d ?? "0.00"} />}
          subtext="Captured less refunded calls"
        />
      </div>

      {summary && summary.recent_payments.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Get started in 3 steps</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your wallet has not settled any agent calls yet. Follow these steps to make your first paid HTTP 402 call:
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Link
              href="/buy/wallet"
              className="rounded-md border border-border p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <IconCircleCheck className="size-4 text-primary" />
                1. Add funds
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Top up $5–$100 via PayPal JS SDK Orders v2.
              </p>
            </Link>
            <Link
              href="/buy/keys"
              className="rounded-md border border-border p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <IconCircleCheck className="size-4 text-primary" />
                2. Create an agent key
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Set per-call and daily spending caps for your agent.
              </p>
            </Link>
            <Link
              href="/buy/keys"
              className="rounded-md border border-border p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <IconCircleCheck className="size-4 text-primary" />
                3. Make a paid call
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Wrap fetch with <code className="font-mono">createPaidFetch</code>.
              </p>
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-border bg-card p-5 lg:col-span-7">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Daily spend (30 days)</h2>
              <p className="text-xs text-muted-foreground">
                Settled USD volume across all agent keys (UTC days)
              </p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              Peak: <Money value={maxDailySpend.toFixed(2)} />
            </span>
          </div>

          <div
            className="mt-6 flex h-44 items-end gap-1 pt-4"
            aria-label="30-day daily spend chart"
          >
            {series.map((item) => {
              const val = Number.parseFloat(item.spent) || 0;
              const heightPct = Math.max(6, Math.round((val / maxDailySpend) * 100));
              return (
                <div
                  key={item.date}
                  className="group relative flex flex-1 flex-col items-center justify-end h-full"
                  title={`${item.date}: $${item.spent} (${item.count} calls)`}
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

        <div className="rounded-lg border border-border bg-card p-5 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Recent payments</h2>
              <p className="text-xs text-muted-foreground">Last 10 agent calls</p>
            </div>
            <Link
              href="/buy/payments"
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>

          <div className="mt-4 divide-y divide-border">
            {(summary?.recent_payments ?? []).slice(0, 10).map((p) => {
              let hostPath = p.url;
              try {
                const u = new URL(p.url);
                hostPath = `${u.host}${u.pathname}`;
              } catch {
                // keep raw url
              }
              return (
                <div
                  key={p.payment_id}
                  className="flex items-center justify-between gap-2 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                        {p.method}
                      </span>
                      <span className="truncate font-mono text-xs">{hostPath}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{p.key_name}</span>
                      <span>·</span>
                      <RelativeDate iso={p.created_at} />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Money value={p.amount} className="font-semibold" />
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
