/**
 * Buyer Wallet page (`/buy/wallet`, SPEC.md section 11.4.2).
 *
 * Displays:
 * - Current Available and Held balance card with primary "Add funds" button
 * - "Add funds" modal dialog with preset chips (`$5`, `$10`, `$25`, `$50`), custom amount input (`$5.00`–`$100.00`),
 *   PayPal JS SDK (`@paypal/react-paypal-js`) button container + instant Sandbox approval flow
 * - Top-up history AG Grid `<DataTable>` (`Date`, `Amount`, `Status`, `PayPal Order ID`, `PayPal Capture ID`)
 * - Footnote: "Wallet balances are prepaid API credits for agent calls and are non-withdrawable."
 */

"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { IconBrandPaypal, IconPlus, IconWallet } from "@tabler/icons-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import { DataTable } from "@/components/haggles/data-table";
import {
  Money,
  RelativeDate,
  StatusBadge,
  TruncatedId,
} from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type PortalBuyerSummary,
  type PortalTopup,
  portalApi,
} from "@/lib/portal-api";

const PRESETS = ["5.00", "10.00", "25.00", "50.00"] as const;

export default function BuyerWalletPage() {
  const [summary, setSummary] = React.useState<PortalBuyerSummary | null>(null);
  const [topups, setTopups] = React.useState<PortalTopup[]>([]);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("10.00");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const [sum, list] = await Promise.all([
      portalApi.getBuyerSummary(),
      portalApi.listBuyerTopups(),
    ]);
    setSummary(sum);
    setTopups(list);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSandboxTopup = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await portalApi.createAndCaptureTopup(amount);
      await refresh();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Top-up failed");
    } finally {
      setSubmitting(false);
    }
  };

  const columns = React.useMemo<ColDef<PortalTopup>[]>(
    () => [
      {
        headerName: "Date",
        field: "created_at",
        minWidth: 150,
        cellRenderer: (params: ICellRendererParams<PortalTopup>) =>
          params.data ? <RelativeDate iso={params.data.created_at} /> : null,
      },
      {
        headerName: "Amount",
        field: "amount",
        minWidth: 120,
        cellRenderer: (params: ICellRendererParams<PortalTopup>) =>
          params.data ? (
            <Money value={params.data.amount} className="font-semibold" />
          ) : null,
      },
      {
        headerName: "Status",
        field: "status",
        minWidth: 120,
        cellRenderer: (params: ICellRendererParams<PortalTopup>) =>
          params.data ? <StatusBadge status={params.data.status} /> : null,
      },
      {
        headerName: "PayPal Order ID",
        field: "paypal_order_id",
        minWidth: 180,
        cellRenderer: (params: ICellRendererParams<PortalTopup>) =>
          params.data ? (
            <TruncatedId value={params.data.paypal_order_id} head={10} tail={4} />
          ) : null,
      },
      {
        headerName: "PayPal Capture ID",
        field: "paypal_capture_id",
        minWidth: 180,
        cellRenderer: (params: ICellRendererParams<PortalTopup>) =>
          params.data?.paypal_capture_id ? (
            <TruncatedId value={params.data.paypal_capture_id} head={10} tail={4} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [],
  );

  const paypalClientId =
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "sb";

  return (
    <AppShell
      title="Wallet"
      description="Fund your prepaid agent wallet with PayPal Orders v2 ($5.00 min, $100.00 max per top-up, $500.00 max balance)."
      actions={
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <IconPlus className="size-3.5" />
          Add funds
        </Button>
      }
    >
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <IconWallet className="size-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Available prepaid balance
              </div>
              <div className="mt-1 text-3xl font-semibold tracking-tight">
                <Money value={summary?.available ?? "0.00"} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Held in flight: <Money value={summary?.held ?? "0.00"} /> (
                {summary?.in_flight_count ?? 0} active holds) · Wallet ID:{" "}
                <span className="font-mono">{summary?.wallet_id ?? "wal_..."}</span>
              </div>
            </div>
          </div>

          <Button size="lg" onClick={() => setModalOpen(true)}>
            <IconPlus className="size-4" />
            Add funds
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Top-up history</h2>
          <span className="text-xs text-muted-foreground">
            Settled via PayPal Orders v2
          </span>
        </div>
        <DataTable
          rowData={topups}
          columnDefs={columns}
          height={340}
          emptyText="No top-ups yet. Click 'Add funds' to credit your wallet."
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Wallet balances are prepaid API credits for agent calls and are non-withdrawable.
        </p>
      </div>

      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-funds-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg">
            <h2 id="add-funds-title" className="text-base font-semibold">
              Add funds to wallet
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose a preset or enter a custom USD amount ($5.00 – $100.00).
            </p>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset)}
                  className={`rounded-md border px-3 py-2 font-mono text-xs font-medium transition-colors ${
                    amount === preset
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-background hover:bg-muted"
                  }`}
                >
                  ${preset.replace(".00", "")}
                </button>
              ))}
            </div>

            <div className="mt-4">
              <Label htmlFor="custom-topup-amount" className="text-xs">
                Amount (USD)
              </Label>
              <Input
                id="custom-topup-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>

            {error ? (
              <div
                role="alert"
                className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </div>
            ) : null}

            <div className="mt-5 space-y-3">
              <Button
                className="w-full"
                size="lg"
                disabled={submitting}
                onClick={handleSandboxTopup}
              >
                <IconBrandPaypal className="size-4" />
                {submitting
                  ? "Capturing PayPal Order..."
                  : `Pay $${amount} with PayPal Sandbox`}
              </Button>

              {paypalClientId !== "sb" ? (
                <div className="rounded-md border border-border p-2">
                  <PayPalScriptProvider
                    options={{
                      clientId: paypalClientId,
                      currency: "USD",
                      intent: "capture",
                    }}
                  >
                    <PayPalButtons
                      style={{ layout: "horizontal", height: 38 }}
                      createOrder={async () => {
                        const topup = await portalApi.createAndCaptureTopup(amount);
                        return topup.paypal_order_id;
                      }}
                      onApprove={async () => {
                        await refresh();
                        setModalOpen(false);
                      }}
                    />
                  </PayPalScriptProvider>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setError(null);
                  setModalOpen(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
