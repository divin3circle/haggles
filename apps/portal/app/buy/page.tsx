/**
 * Buyer Overview page (`/buy`, SPEC.md section 11.4.1).
 *
 * Interactive composable dashboard powered by `DraggableWidgetGrid` (`motion/react`):
 * - Four `sm` widgets: Available balance (+ Add funds), Held in flight, Spent today (with daily cap bar), and Spent 30 days (with 14d mini-bars)
 * - Two `wide` widgets: 30-day daily spend bar chart + Recent agent payment traces
 * - Low-balance `< $1.00` warning alert with "Add funds" action
 * - Empty state checklist (`Add funds` → `Create an agent key` → `Make a paid call`) when no payments exist
 */

"use client";

import { parseMoney } from "@haggles/core";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCircleCheck,
  IconGripVertical,
  IconPlus,
} from "@tabler/icons-react";
import Link from "next/link";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import {
  Money,
  RelativeDate,
  StatusBadge,
} from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import DraggableWidgetGrid, {
  type WidgetItem,
} from "@/components/ui/draggable-widget-grid";
import {
  type PortalBuyerSummary,
  portalApi,
} from "@/lib/portal-api";

type BuyerWidgetKind =
  | "available"
  | "held"
  | "spent-today"
  | "spent-30d"
  | "daily-spend"
  | "recent-payments";

interface BuyerWidget extends WidgetItem {
  kind: BuyerWidgetKind;
}

const BUYER_WIDGETS: BuyerWidget[] = [
  {
    id: "available",
    kind: "available",
    size: "sm",
    label: "Available balance",
  },
  {
    id: "held",
    kind: "held",
    size: "sm",
    label: "Held in flight",
  },
  {
    id: "spent-today",
    kind: "spent-today",
    size: "sm",
    label: "Spent today (UTC)",
  },
  {
    id: "spent-30d",
    kind: "spent-30d",
    size: "sm",
    label: "Spent (30 days)",
  },
  {
    id: "daily-spend",
    kind: "daily-spend",
    size: "wide",
    label: "Daily spend (30 days)",
  },
  {
    id: "recent-payments",
    kind: "recent-payments",
    size: "wide",
    label: "Recent payments",
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
  const dailyCapNum = summary?.smallest_daily_max
    ? Number(summary.smallest_daily_max)
    : 5;
  const progressPct =
    dailyCapNum > 0
      ? Math.min(100, Math.round((spentTodayNum / dailyCapNum) * 100))
      : 0;

  const maxDailySpend = Math.max(
    0.01,
    ...series.map((d) => Number.parseFloat(d.spent) || 0),
  );

  const recent14 = series.slice(-14);

  const renderWidget = (item: BuyerWidget) => {
    switch (item.kind) {
      case "available":
        return (
          <WidgetShell
            title="Available"
            meta={
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                <PulseDot tone={isLowBalance ? "warn" : "ok"} pulse />
                {isLowBalance ? "low" : "ready"}
              </span>
            }
          >
            <div className="text-[28px] leading-none font-semibold tracking-tight text-foreground tabular-nums @[240px]:text-[30px]">
              <Money value={summary?.available ?? "0.00"} />
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              Ready for immediate HTTP 402 agent spend
            </p>
            <div className="mt-auto pt-3">
              <Link
                href="/buy/wallet"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Add funds
                <IconArrowRight className="size-3.5" />
              </Link>
            </div>
          </WidgetShell>
        );

      case "held": {
        const count = summary?.in_flight_count ?? 0;
        return (
          <WidgetShell title="Held in flight" meta="60s TTL">
            <div className="text-[28px] leading-none font-semibold tracking-tight text-foreground tabular-nums @[240px]:text-[30px]">
              <Money value={summary?.held ?? "0.00"} />
            </div>
            <p className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
              <PulseDot tone={count > 0 ? "ok" : "idle"} pulse={count > 0} />
              <span className="truncate">
                {count} in-flight authorization{count === 1 ? "" : "s"}
              </span>
            </p>
            <div className="mt-auto flex h-4 gap-[2px] pt-3" aria-hidden="true">
              {Array.from({ length: 16 }, (_, i) => (
                <span
                  key={i}
                  className={`flex-1 rounded-[1.5px] ${
                    i < count * 3 ? "bg-primary/80" : "bg-foreground/12"
                  }`}
                />
              ))}
            </div>
          </WidgetShell>
        );
      }

      case "spent-today":
        return (
          <WidgetShell
            title="Spent today"
            meta={
              <span className="font-mono text-[11px] tabular-nums">
                {progressPct}% cap
              </span>
            }
          >
            <div className="text-[28px] leading-none font-semibold tracking-tight text-foreground tabular-nums @[240px]:text-[30px]">
              <Money value={summary?.spent_today ?? "0.00"} />
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              {summary?.smallest_daily_max
                ? `${progressPct}% of $${summary.smallest_daily_max}/day smallest active key cap`
                : "No active daily cap"}
            </p>
            <div className="mt-auto pt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.max(4, progressPct)}%` }}
                />
              </div>
            </div>
          </WidgetShell>
        );

      case "spent-30d":
        return (
          <WidgetShell title="Spent (30d)" meta="MTD net">
            <div className="text-[28px] leading-none font-semibold tracking-tight text-foreground tabular-nums @[240px]:text-[30px]">
              <Money value={summary?.spent_30d ?? "0.00"} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Captured less refunded calls
            </p>
            <div
              role="img"
              aria-label="Daily spend over the last 14 days"
              className="mt-auto flex h-9 items-end gap-[3px] pt-2"
            >
              {(recent14.length > 0
                ? recent14
                : Array.from({ length: 14 }, (_, i) => ({
                    date: String(i),
                    spent: "0.02",
                    count: 1,
                  }))
              ).map((d, i, arr) => {
                const v = Number.parseFloat(d.spent) || 0;
                const pct = Math.max(12, Math.round((v / maxDailySpend) * 100));
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

      case "daily-spend":
        return (
          <WidgetShell
            title="Daily spend (30 days)"
            meta={
              <span className="font-mono text-[11px]">
                Peak: <Money value={maxDailySpend.toFixed(2)} />
              </span>
            }
          >
            <p className="text-xs text-muted-foreground">
              Settled USD volume across all agent keys (UTC days)
            </p>
            <div
              className="mt-auto flex h-28 items-end gap-1 pt-3"
              aria-label="30-day daily spend chart"
            >
              {series.map((entry, idx) => {
                const val = Number.parseFloat(entry.spent) || 0;
                const heightPct = Math.max(
                  8,
                  Math.round((val / maxDailySpend) * 100),
                );
                const isToday = idx === series.length - 1;
                return (
                  <div
                    key={entry.date}
                    className="group relative flex h-full flex-1 flex-col items-center justify-end"
                    title={`${entry.date}: $${entry.spent} (${entry.count} calls)`}
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

      case "recent-payments":
        return (
          <WidgetShell
            title="Recent payments"
            meta={
              <Link
                href="/buy/payments"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View all
                <IconArrowRight className="size-3" />
              </Link>
            }
          >
            <ol
              aria-label="Most recent agent payments"
              className="my-auto divide-y divide-border/60 text-xs"
            >
              {(summary?.recent_payments ?? []).slice(0, 4).map((p) => {
                let hostPath = p.url;
                try {
                  const u = new URL(p.url);
                  hostPath = `${u.host}${u.pathname}`;
                } catch {
                  // keep raw url
                }
                return (
                  <li
                    key={p.payment_id}
                    className="flex items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                          {p.method}
                        </span>
                        <span className="truncate font-mono text-xs">
                          {hostPath}
                        </span>
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
                  </li>
                );
              })}
            </ol>
          </WidgetShell>
        );
    }
  };

  return (
    <AppShell
      section="Buy"
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
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300"
        >
          <div className="flex items-center gap-2">
            <IconAlertTriangle className="size-4 shrink-0" />
            <span>
              <strong>Low wallet balance:</strong> Available balance is below{" "}
              <span className="font-mono">$1.00</span>. Agent calls may fail
              with <code className="font-mono">insufficient_funds</code>.
            </span>
          </div>
          <Link href="/buy/wallet">
            <Button variant="outline" size="xs">
              Add funds
            </Button>
          </Link>
        </div>
      ) : null}

      {summary && summary.recent_payments.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Get started in 3 steps</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your wallet has not settled any agent calls yet. Follow these steps
            to make your first paid HTTP 402 call:
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
                Wrap fetch with <code className="font-mono">createHaggles</code>
                .
              </p>
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-[1120px]">
        <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <IconGripVertical className="size-3.5 opacity-60" />
          <span className="[@media(pointer:coarse)]:hidden">
            Drag and rearrange cards to customize your buyer dashboard layout
            (or hold Alt + Arrow keys).
          </span>
          <span className="hidden [@media(pointer:coarse)]:inline">
            Press and hold a card, then drag to rearrange your buyer dashboard.
          </span>
        </p>

        <DraggableWidgetGrid
          items={BUYER_WIDGETS}
          cellSize={220}
          gap={14}
          radius={18}
          renderItem={(item) => renderWidget(item as BuyerWidget)}
        />
      </div>
    </AppShell>
  );
}
