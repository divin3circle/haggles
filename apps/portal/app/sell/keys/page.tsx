/**
 * Seller Keys page (`/sell/keys`, SPEC.md section 11.5.6).
 *
 * Displays:
 * - AG Grid `<DataTable>` with columns: `Name`, `Prefix` (`hgs_test_4P8m…`), `Last used`, `Created`, `Status`, `Actions` (`Revoke`)
 * - "Create key" button (maximum 2 active keys so a seller can rotate without downtime) → opens `<KeyReveal>` show-once dialog
 * - "Revoke" confirmation dialog
 */

"use client";

import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import { DataTable } from "@/components/haggles/data-table";
import {
  KeyReveal,
  RelativeDate,
  StatusBadge,
  TruncatedId,
} from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type PortalSellerKey, portalApi } from "@/lib/portal-api";

export default function SellerKeysPage() {
  const [keys, setKeys] = React.useState<PortalSellerKey[]>([]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("production-seller-key");
  const [revealedKey, setRevealedKey] = React.useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<PortalSellerKey | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const list = await portalApi.listSellerKeys();
    setKeys(list);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeCount = keys.filter((k) => k.status === "active").length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const created = await portalApi.createSellerKey(name);
      setCreateOpen(false);
      setRevealedKey(created.key);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    await portalApi.revokeSellerKey(revokeTarget.id);
    setRevokeTarget(null);
    await refresh();
  };

  const columns = React.useMemo<ColDef<PortalSellerKey>[]>(
    () => [
      {
        headerName: "Name",
        field: "name",
        minWidth: 180,
      },
      {
        headerName: "Prefix",
        field: "prefix",
        minWidth: 180,
        cellRenderer: (params: ICellRendererParams<PortalSellerKey>) =>
          params.data ? (
            <TruncatedId value={`${params.data.prefix}…`} head={16} tail={0} />
          ) : null,
      },
      {
        headerName: "Last used",
        field: "last_used_at",
        minWidth: 130,
        cellRenderer: (params: ICellRendererParams<PortalSellerKey>) =>
          params.data ? <RelativeDate iso={params.data.last_used_at} /> : null,
      },
      {
        headerName: "Created",
        field: "created_at",
        minWidth: 130,
        cellRenderer: (params: ICellRendererParams<PortalSellerKey>) =>
          params.data ? <RelativeDate iso={params.data.created_at} /> : null,
      },
      {
        headerName: "Status",
        field: "status",
        minWidth: 110,
        cellRenderer: (params: ICellRendererParams<PortalSellerKey>) =>
          params.data ? <StatusBadge status={params.data.status} /> : null,
      },
      {
        headerName: "Actions",
        field: "id",
        minWidth: 120,
        sortable: false,
        cellRenderer: (params: ICellRendererParams<PortalSellerKey>) => {
          const row = params.data;
          if (!row || row.status === "revoked") {
            return <span className="text-xs text-muted-foreground">Revoked</span>;
          }
          return (
            <Button
              variant="destructive"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                setRevokeTarget(row);
              }}
            >
              <IconTrash className="size-3" />
              Revoke
            </Button>
          );
        },
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Seller keys"
      description="Authenticate your @haggles/server middleware with /v1/settle and /v1/release. Maximum 2 active keys for zero-downtime key rotation."
      actions={
        <Button
          size="sm"
          disabled={activeCount >= 2}
          onClick={() => {
            setName(activeCount === 0 ? "primary-middleware" : "rotation-secondary");
            setError(null);
            setCreateOpen(true);
          }}
          title={
            activeCount >= 2
              ? "Maximum 2 active keys reached. Revoke a key to rotate."
              : "Create seller key"
          }
        >
          <IconPlus className="size-3.5" />
          Create key ({activeCount}/2 active)
        </Button>
      }
    >
      <DataTable
        rowData={keys}
        columnDefs={columns}
        height={360}
        emptyText="No seller keys yet. Create a key to authenticate your middleware."
      />

      {createOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
          >
            <h2 className="text-base font-semibold">Create seller key</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              You can have up to 2 active seller keys at once to rotate credentials without downtime.
            </p>
            <div className="mt-4">
              <Label htmlFor="seller-key-name" className="text-xs">
                Key name
              </Label>
              <Input
                id="seller-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-1"
              />
            </div>

            {error ? (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Create key</Button>
            </div>
          </form>
        </div>
      ) : null}

      {revokeTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg">
            <h2 className="text-base font-semibold">
              Revoke seller key &ldquo;{revokeTarget.name}&rdquo;?
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Middleware instances using <code className="font-mono">{revokeTarget.prefix}…</code> will immediately fail settlement with <code className="font-mono">401 key_revoked</code>.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRevoke}>
                Revoke key
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <KeyReveal
        open={Boolean(revealedKey)}
        title="Seller key created — save your secret"
        envVarName="HAGGLES_SELLER_KEY"
        fullKey={revealedKey}
        onClose={() => setRevealedKey(null)}
      />
    </AppShell>
  );
}
