/**
 * Seller Calls page (`/sell/calls`, SPEC.md section 11.5.4).
 *
 * Displays:
 * - Filter bar: Endpoint select, Status select (`authorized` | `captured` | `released` | `refunded`)
 * - AG Grid `<DataTable>` (25/page): `Time`, `Method + Route`, `Agent` (pseudonymous `agent_ref`), `Gross`, `Fee`, `Net`, `Status`, `Payment ID`
 * - Row click opens a detail sheet with full payment info and a **Refund** button for `captured` calls `< 24 h` old
 */

"use client";

import { IconArrowBackUp, IconX } from "@tabler/icons-react";
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
import {
  type PortalSellerCall,
  type PortalSellerEndpoint,
  portalApi,
} from "@/lib/portal-api";

export default function SellerCallsPage() {
  const [calls, setCalls] = React.useState<PortalSellerCall[]>([]);
  const [endpoints, setEndpoints] = React.useState<PortalSellerEndpoint[]>([]);
  const [endpointFilter, setEndpointFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [selected, setSelected] = React.useState<PortalSellerCall | null>(null);
  const [confirmRefund, setConfirmRefund] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const filters: { endpoint?: string; status?: string } = {};
    if (endpointFilter) filters.endpoint = endpointFilter;
    if (statusFilter) filters.status = statusFilter;
    const list = await portalApi.listSellerCalls(filters);
    setCalls(list);
  }, [endpointFilter, statusFilter]);

  React.useEffect(() => {
    void portalApi.listSellerEndpoints().then(setEndpoints);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const isRefundable = React.useMemo(() => {
    if (!selected || selected.status !== "captured") return false;
    const capturedTime = new Date(
      selected.captured_at ?? selected.created_at,
    ).getTime();
    return Date.now() - capturedTime < 24 * 3_600_000;
  }, [selected]);

  const handleRefund = async () => {
    if (!selected) return;
    await portalApi.refundSellerCall(selected.payment_id);
    setConfirmRefund(false);
    setSelected(null);
    await refresh();
  };

  const columns = React.useMemo<ColDef<PortalSellerCall>[]>(
    () => [
      {
        headerName: "Time",
        field: "created_at",
        minWidth: 125,
        cellRenderer: (params: ICellRendererParams<PortalSellerCall>) =>
          params.data ? <RelativeDate iso={params.data.created_at} /> : null,
      },
      {
        headerName: "Method + Route",
        field: "route",
        minWidth: 230,
        cellRenderer: (params: ICellRendererParams<PortalSellerCall>) =>
          params.data ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                {params.data.method}
              </span>
              <span>{params.data.route}</span>
            </span>
          ) : null,
      },
      {
        headerName: "Agent (pseudonymous)",
        field: "agent_ref",
        minWidth: 155,
        cellRenderer: (params: ICellRendererParams<PortalSellerCall>) =>
          params.data ? (
            <TruncatedId value={params.data.agent_ref} head={8} tail={4} />
          ) : null,
      },
      {
        headerName: "Gross",
        field: "amount",
        minWidth: 100,
        cellRenderer: (params: ICellRendererParams<PortalSellerCall>) =>
          params.data ? <Money value={params.data.amount} /> : null,
      },
      {
        headerName: "Fee (5%)",
        field: "fee",
        minWidth: 100,
        cellRenderer: (params: ICellRendererParams<PortalSellerCall>) =>
          params.data ? (
            <Money value={params.data.fee} className="text-muted-foreground" />
          ) : null,
      },
      {
        headerName: "Net",
        field: "seller_net",
        minWidth: 105,
        cellRenderer: (params: ICellRendererParams<PortalSellerCall>) =>
          params.data ? (
            <Money value={params.data.seller_net} className="font-semibold" />
          ) : null,
      },
      {
        headerName: "Status",
        field: "status",
        minWidth: 110,
        cellRenderer: (params: ICellRendererParams<PortalSellerCall>) =>
          params.data ? <StatusBadge status={params.data.status} /> : null,
      },
      {
        headerName: "Payment ID",
        field: "payment_id",
        minWidth: 165,
        cellRenderer: (params: ICellRendererParams<PortalSellerCall>) =>
          params.data ? (
            <TruncatedId value={params.data.payment_id} head={9} tail={4} />
          ) : null,
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Calls"
      description="Inspect every metered agent request, fee split, and pseudonymous agent_ref."
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          aria-label="Filter by endpoint"
          value={endpointFilter}
          onChange={(e) => setEndpointFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs"
        >
          <option value="">All endpoints</option>
          {endpoints.map((ep) => (
            <option key={ep.id} value={ep.route}>
              {ep.method} {ep.route}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by call status"
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
      </div>

      <DataTable
        rowData={calls}
        columnDefs={columns}
        height={460}
        onRowClicked={(row) => {
          setSelected(row);
          setConfirmRefund(false);
        }}
        emptyText="No calls match the selected filters."
      />

      {selected ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="call-detail-title"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card p-6 text-card-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h2 id="call-detail-title" className="text-sm font-semibold">
                Call detail
              </h2>
              <p className="font-mono text-xs text-muted-foreground">
                {selected.payment_id}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSelected(null)}
              aria-label="Close call detail"
            >
              <IconX className="size-4" />
            </Button>
          </div>

          <div className="mt-4 flex-1 space-y-4 overflow-y-auto text-xs">
            <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/40 p-3">
              <div>
                <div className="text-muted-foreground">Gross</div>
                <div className="mt-0.5 font-semibold">
                  <Money value={selected.amount} />
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Fee (5%)</div>
                <div className="mt-0.5 font-semibold">
                  <Money value={selected.fee} />
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Seller net</div>
                <div className="mt-0.5 font-semibold text-primary">
                  <Money value={selected.seller_net} />
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={selected.status} />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Route</span>
                <span className="font-mono">
                  {selected.method} {selected.route}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pseudonymous agent</span>
                <TruncatedId value={selected.agent_ref} head={10} tail={4} />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created at</span>
                <span className="font-mono">{selected.created_at}</span>
              </div>
            </div>

            {selected.receipt ? (
              <div className="space-y-1.5 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Payment-Receipt</span>
                  <CopyButton text={selected.receipt} label="Copy receipt" />
                </div>
                <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[11px] break-all whitespace-pre-wrap">
                  {selected.receipt}
                </pre>
              </div>
            ) : null}

            {isRefundable ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="font-semibold">Full refund available (&lt; 24 h)</div>
                <p className="mt-1 text-muted-foreground">
                  Refunding reverses your net share (<Money value={selected.seller_net} />) and Haggles&apos;s fee (<Money value={selected.fee} />), crediting the buyer&apos;s available balance (<Money value={selected.amount} />).
                </p>
                {!confirmRefund ? (
                  <Button
                    variant="outline"
                    size="xs"
                    className="mt-3"
                    onClick={() => setConfirmRefund(true)}
                  >
                    <IconArrowBackUp className="size-3.5" />
                    Refund <Money value={selected.amount} />
                  </Button>
                ) : (
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={handleRefund}
                    >
                      Confirm full refund
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setConfirmRefund(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
