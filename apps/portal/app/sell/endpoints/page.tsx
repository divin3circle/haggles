/**
 * Seller Endpoints page (`/sell/endpoints`, SPEC.md section 11.5.3).
 *
 * Displays:
 * - Note: "Endpoints are registered automatically the first time your middleware settles a call."
 * - AG Grid `<DataTable>` with columns: `Method + Route`, `Display name`, `Last price`, `Calls (30d)`, `Revenue (30d)`, `Status` (`active` | `hidden`)
 * - Row click opens a sheet to edit `display_name`, `description`, and `status` (`PATCH /portal/v1/seller/endpoints/:id`)
 */

"use client";

import { IconX } from "@tabler/icons-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import { DataTable } from "@/components/haggles/data-table";
import { EmptyState, Money, StatusBadge } from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type PortalSellerEndpoint, portalApi } from "@/lib/portal-api";

export default function SellerEndpointsPage() {
  const [endpoints, setEndpoints] = React.useState<PortalSellerEndpoint[]>([]);
  const [selected, setSelected] = React.useState<PortalSellerEndpoint | null>(
    null,
  );
  const [displayName, setDisplayName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState<"active" | "hidden">("active");

  const refresh = React.useCallback(async () => {
    const list = await portalApi.listSellerEndpoints();
    setEndpoints(list);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const openSheet = (ep: PortalSellerEndpoint) => {
    setSelected(ep);
    setDisplayName(ep.display_name ?? "");
    setDescription(ep.description ?? "");
    setStatus(ep.status);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    await portalApi.updateSellerEndpoint(selected.id, {
      display_name: displayName.trim() || null,
      description: description.trim() || null,
      status,
    });
    setSelected(null);
    await refresh();
  };

  const columns = React.useMemo<ColDef<PortalSellerEndpoint>[]>(
    () => [
      {
        headerName: "Method + Route",
        field: "route",
        minWidth: 250,
        cellRenderer: (params: ICellRendererParams<PortalSellerEndpoint>) =>
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
        headerName: "Display name",
        field: "display_name",
        minWidth: 180,
        cellRenderer: (params: ICellRendererParams<PortalSellerEndpoint>) =>
          params.data?.display_name ? (
            <span>{params.data.display_name}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        headerName: "Last price",
        field: "last_price",
        minWidth: 110,
        cellRenderer: (params: ICellRendererParams<PortalSellerEndpoint>) =>
          params.data ? <Money value={params.data.last_price} /> : null,
      },
      {
        headerName: "Calls (30d)",
        field: "calls_30d",
        minWidth: 115,
        cellRenderer: (params: ICellRendererParams<PortalSellerEndpoint>) =>
          params.data ? (
            <span className="font-mono tabular-nums">
              {params.data.calls_30d.toLocaleString()}
            </span>
          ) : null,
      },
      {
        headerName: "Revenue (30d)",
        field: "revenue_30d",
        minWidth: 130,
        cellRenderer: (params: ICellRendererParams<PortalSellerEndpoint>) =>
          params.data ? (
            <Money value={params.data.revenue_30d} className="font-semibold" />
          ) : null,
      },
      {
        headerName: "Status",
        field: "status",
        minWidth: 110,
        cellRenderer: (params: ICellRendererParams<PortalSellerEndpoint>) =>
          params.data ? <StatusBadge status={params.data.status} /> : null,
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Endpoints"
      description="Endpoints are registered automatically the first time your middleware settles a call."
    >
      {endpoints.length === 0 ? (
        <EmptyState
          title="No endpoints registered yet"
          description="Endpoints appear here automatically after their first paid HTTP 402 call."
          action={
            <Link href="/sell/setup">
              <Button size="sm">Go to Setup</Button>
            </Link>
          }
        />
      ) : (
        <DataTable
          rowData={endpoints}
          columnDefs={columns}
          height={420}
          onRowClicked={openSheet}
        />
      )}

      {selected ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="endpoint-sheet-title"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card p-6 text-card-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h2 id="endpoint-sheet-title" className="text-sm font-semibold">
                Edit endpoint metadata
              </h2>
              <p className="font-mono text-xs text-muted-foreground">
                {selected.method} {selected.route}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSelected(null)}
              aria-label="Close endpoint sheet"
            >
              <IconX className="size-4" />
            </Button>
          </div>

          <form onSubmit={handleSave} className="mt-4 space-y-4 text-xs">
            <div>
              <Label htmlFor="ep-display-name" className="text-xs">
                Display name
              </Label>
              <Input
                id="ep-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Lithium Spot Price Index"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="ep-description" className="text-xs">
                Description
              </Label>
              <Textarea
                id="ep-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="ep-status" className="text-xs">
                Portal visibility status
              </Label>
              <select
                id="ep-status"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "active" | "hidden")
                }
                className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs"
              >
                <option value="active">Active</option>
                <option value="hidden">Hidden</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSelected(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}
