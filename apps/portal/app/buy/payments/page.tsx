/**
 * Buyer Payments page (`/buy/payments`, SPEC.md section 11.4.4).
 *
 * Displays:
 * - Filter bar: Key select, Status select (`authorized` | `captured` | `released` | `refunded`), Seller search
 * - AG Grid `<DataTable>` (25/page): `Time`, `Method + URL`, `Seller`, `Key`, `Amount`, `Status`, `Payment ID`
 * - Row click opens a detail sheet with the full payment timeline (`authorized_at` → `captured_at` / `released_at` / `refunded_at`),
 *   `challenge_id`, `payment_id`, and the signed `Payment-Receipt` token with a copy button
 */

"use client";

import { IconX } from "@tabler/icons-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import { DataTable } from "@/components/haggles/data-table";
import {
  CopyButton,
  Money,
  RelativeDate,
  StatusBadge,
  TruncatedId,
} from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type PortalAgentKey,
  type PortalBuyerPayment,
  portalApi,
} from "@/lib/portal-api";

export default function BuyerPaymentsPage() {
  const [payments, setPayments] = React.useState<PortalBuyerPayment[]>([]);
  const [keys, setKeys] = React.useState<PortalAgentKey[]>([]);
  const [keyFilter, setKeyFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [sellerFilter, setSellerFilter] = React.useState("");
  const [selected, setSelected] = React.useState<PortalBuyerPayment | null>(null);

  React.useEffect(() => {
    void portalApi.listBuyerKeys().then(setKeys);
  }, []);

  React.useEffect(() => {
    const filters: { key?: string; status?: string; seller?: string } = {};
    if (keyFilter) filters.key = keyFilter;
    if (statusFilter) filters.status = statusFilter;
    if (sellerFilter) filters.seller = sellerFilter;
    void portalApi.listBuyerPayments(filters).then(setPayments);
  }, [keyFilter, statusFilter, sellerFilter]);

  const columns = React.useMemo<ColDef<PortalBuyerPayment>[]>(
    () => [
      {
        headerName: "Time",
        field: "created_at",
        minWidth: 130,
        cellRenderer: (params: ICellRendererParams<PortalBuyerPayment>) =>
          params.data ? <RelativeDate iso={params.data.created_at} /> : null,
      },
      {
        headerName: "Method + URL",
        field: "url",
        minWidth: 270,
        cellRenderer: (params: ICellRendererParams<PortalBuyerPayment>) => {
          const row = params.data;
          if (!row) return null;
          let displayUrl = row.url;
          try {
            const u = new URL(row.url);
            displayUrl = `${u.host}${u.pathname}`;
          } catch {
            // keep original
          }
          return (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                {row.method}
              </span>
              <span title={row.url}>{displayUrl}</span>
            </span>
          );
        },
      },
      {
        headerName: "Seller",
        field: "seller_id",
        minWidth: 155,
        cellRenderer: (params: ICellRendererParams<PortalBuyerPayment>) =>
          params.data ? (
            <TruncatedId value={params.data.seller_id} head={9} tail={4} />
          ) : null,
      },
      {
        headerName: "Key",
        field: "key_name",
        minWidth: 140,
      },
      {
        headerName: "Amount",
        field: "amount",
        minWidth: 110,
        cellRenderer: (params: ICellRendererParams<PortalBuyerPayment>) =>
          params.data ? (
            <Money value={params.data.amount} className="font-semibold" />
          ) : null,
      },
      {
        headerName: "Status",
        field: "status",
        minWidth: 115,
        cellRenderer: (params: ICellRendererParams<PortalBuyerPayment>) =>
          params.data ? <StatusBadge status={params.data.status} /> : null,
      },
      {
        headerName: "Payment ID",
        field: "payment_id",
        minWidth: 165,
        cellRenderer: (params: ICellRendererParams<PortalBuyerPayment>) =>
          params.data ? (
            <TruncatedId value={params.data.payment_id} head={9} tail={4} />
          ) : null,
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Payments"
      description="Inspect every HTTP 402 authorization, capture, release, and refund across your agent keys."
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          aria-label="Filter by agent key"
          value={keyFilter}
          onChange={(e) => setKeyFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2.5 text-xs"
        >
          <option value="">All keys</option>
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name} ({k.prefix.slice(0, 12)}…)
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2.5 text-xs"
        >
          <option value="">All statuses</option>
          <option value="authorized">Authorized</option>
          <option value="captured">Captured</option>
          <option value="released">Released</option>
          <option value="refunded">Refunded</option>
        </select>

        <Input
          placeholder="Search seller ID (slr_...)"
          value={sellerFilter}
          onChange={(e) => setSellerFilter(e.target.value)}
          className="h-8 max-w-xs font-mono text-xs"
        />
      </div>

      <DataTable
        rowData={payments}
        columnDefs={columns}
        height={460}
        onRowClicked={setSelected}
        emptyText="No payments match the selected filters."
      />

      {selected ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-detail-title"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card p-6 text-card-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h2 id="payment-detail-title" className="text-sm font-semibold">
                Payment detail
              </h2>
              <p className="font-mono text-xs text-muted-foreground">
                {selected.payment_id}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSelected(null)}
              aria-label="Close detail sheet"
            >
              <IconX className="size-4" />
            </Button>
          </div>

          <div className="mt-4 flex-1 space-y-4 overflow-y-auto text-xs">
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 p-3">
              <div>
                <div className="text-muted-foreground">Amount</div>
                <div className="mt-0.5 text-lg font-semibold">
                  <Money value={selected.amount} />
                </div>
              </div>
              <StatusBadge status={selected.status} />
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="font-semibold">Resource &amp; Identifiers</div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Endpoint</span>
                <span className="font-mono break-all text-right">
                  {selected.method} {selected.url}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Seller ID</span>
                <TruncatedId value={selected.seller_id} />
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Agent key</span>
                <span>{selected.key_name}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Challenge ID</span>
                <TruncatedId value={selected.challenge_id} />
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="font-semibold">Lifecycle timeline</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Authorized at</span>
                <span className="font-mono">{selected.authorized_at}</span>
              </div>
              {selected.captured_at ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Captured at</span>
                  <span className="font-mono">{selected.captured_at}</span>
                </div>
              ) : null}
              {selected.released_at ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Released at</span>
                  <span className="font-mono">{selected.released_at}</span>
                </div>
              ) : null}
              {selected.refunded_at ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Refunded at</span>
                  <span className="font-mono">{selected.refunded_at}</span>
                </div>
              ) : null}
            </div>

            {selected.receipt ? (
              <div className="space-y-1.5 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Signed Payment-Receipt (JWS)</span>
                  <CopyButton text={selected.receipt} label="Copy Payment-Receipt" />
                </div>
                <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[11px] break-all whitespace-pre-wrap">
                  {selected.receipt}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
