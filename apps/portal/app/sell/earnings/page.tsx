/**
 * Seller Earnings & Payouts page (`/sell/earnings`, SPEC.md section 11.5.5).
 *
 * Displays:
 * - Three `<StatCard>`s: `Pending`, `Processing`, `Paid out`
 * - Payout destination card showing PayPal email, `payer_id`, mode badge (`PayPal` or `Simulated` when `PAYOUTS_FALLBACK_ENABLED=true`),
 *   and a "Request payout" button (enabled when `pending >= $1.00`, disabled with tooltip when `< $1.00` or payout processing)
 * - Payouts AG Grid `<DataTable>` (`Date`, `Amount`, `Status`, `Mode`, `PayPal Batch ID`, `PayPal Item ID`, `Fee`)
 */

"use client";

import { parseMoney } from "@haggles/core";
import { IconBrandPaypal, IconCash } from "@tabler/icons-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import { DataTable } from "@/components/haggles/data-table";
import {
  Money,
  RelativeDate,
  StatCard,
  StatusBadge,
  TruncatedId,
} from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import {
  type PortalSellerPayout,
  type PortalSellerSummary,
  portalApi,
} from "@/lib/portal-api";

export default function SellerEarningsPage() {
  const [summary, setSummary] = React.useState<PortalSellerSummary | null>(null);
  const [payouts, setPayouts] = React.useState<PortalSellerPayout[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const [sum, list] = await Promise.all([
      portalApi.getSellerSummary(),
      portalApi.listSellerPayouts(),
    ]);
    setSummary(sum);
    setPayouts(list);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const pendingMicros = summary ? parseMoney(summary.pending) : 0n;
  const processingMicros = summary ? parseMoney(summary.processing) : 0n;
  const canRequestPayout =
    pendingMicros >= 1_000_000n && processingMicros === 0n && !submitting;

  const handleRequestPayout = async () => {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const p = await portalApi.requestSellerPayout();
      setMessage(
        `Payout ${p.id} for $${p.amount} submitted via PayPal Payouts v1 (batch ${p.paypal_batch_id ?? p.batch_ref}).`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request payout");
    } finally {
      setSubmitting(false);
    }
  };

  const columns = React.useMemo<ColDef<PortalSellerPayout>[]>(
    () => [
      {
        headerName: "Date",
        field: "created_at",
        minWidth: 140,
        cellRenderer: (params: ICellRendererParams<PortalSellerPayout>) =>
          params.data ? <RelativeDate iso={params.data.created_at} /> : null,
      },
      {
        headerName: "Amount",
        field: "amount",
        minWidth: 115,
        cellRenderer: (params: ICellRendererParams<PortalSellerPayout>) =>
          params.data ? (
            <Money value={params.data.amount} className="font-semibold" />
          ) : null,
      },
      {
        headerName: "Status",
        field: "status",
        minWidth: 120,
        cellRenderer: (params: ICellRendererParams<PortalSellerPayout>) =>
          params.data ? <StatusBadge status={params.data.status} /> : null,
      },
      {
        headerName: "Mode",
        field: "mode",
        minWidth: 115,
        cellRenderer: (params: ICellRendererParams<PortalSellerPayout>) =>
          params.data ? (
            <StatusBadge
              status={
                params.data.mode === "simulated" ? "simulated" : "paypal"
              }
            />
          ) : null,
      },
      {
        headerName: "PayPal Batch ID",
        field: "paypal_batch_id",
        minWidth: 175,
        cellRenderer: (params: ICellRendererParams<PortalSellerPayout>) =>
          params.data?.paypal_batch_id ? (
            <TruncatedId value={params.data.paypal_batch_id} head={10} tail={4} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        headerName: "PayPal Item ID",
        field: "paypal_item_id",
        minWidth: 175,
        cellRenderer: (params: ICellRendererParams<PortalSellerPayout>) =>
          params.data?.paypal_item_id ? (
            <TruncatedId value={params.data.paypal_item_id} head={10} tail={4} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        headerName: "PayPal Fee",
        field: "paypal_fee",
        minWidth: 110,
        cellRenderer: (params: ICellRendererParams<PortalSellerPayout>) =>
          params.data?.paypal_fee ? (
            <Money value={params.data.paypal_fee} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Earnings & payouts"
      description="Sweep your pending seller earnings to your linked PayPal account in whole-cent increments ($1.00 minimum)."
    >
      {message ? (
        <div
          role="status"
          className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300"
        >
          {message}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Pending"
          value={<Money value={summary?.pending ?? "0.00"} />}
          subtext="Sub-cent dust (< $0.01) stays in pending until the next whole cent"
        />
        <StatCard
          label="Processing"
          value={<Money value={summary?.processing ?? "0.00"} />}
          subtext="In-flight PayPal Payouts v1 batch"
        />
        <StatCard
          label="Paid out"
          value={<Money value={summary?.paid_out ?? "0.00"} />}
          subtext="Cumulative settled PayPal payouts"
        />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-[#0070ba]/15 text-[#0070ba]">
              <IconBrandPaypal className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Payout destination</span>
                <StatusBadge
                  status={
                    summary?.payout_mode === "simulated" ? "simulated" : "active"
                  }
                />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {summary?.payout_email ?? "builder@sandbox.paypal.example.com"} ·{" "}
                Payer ID:{" "}
                <span className="font-mono">
                  {summary?.payout_paypal_payer_id ?? "WDJJHEBZ4X2LY"}
                </span>
              </div>
            </div>
          </div>

          <Button
            size="lg"
            disabled={!canRequestPayout}
            onClick={handleRequestPayout}
            title={
              pendingMicros < 1_000_000n
                ? "Minimum payout is $1.00"
                : "Request immediate PayPal payout"
            }
          >
            <IconCash className="size-4" />
            {submitting ? "Submitting payout..." : "Request payout"}
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Payout history</h2>
        <DataTable
          rowData={payouts}
          columnDefs={columns}
          height={360}
          emptyText="No payouts yet. Request a payout once your pending balance reaches $1.00."
        />
      </div>
    </AppShell>
  );
}
