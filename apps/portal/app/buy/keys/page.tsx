/**
 * Buyer Agent Keys page (`/buy/keys`, SPEC.md section 11.4.3).
 *
 * Displays:
 * - AG Grid `<DataTable>` with columns: `Name`, `Prefix`, `Policy` (`<PolicySummary>`), `Spent today`, `Last used`, `Status`, `Actions` (`Edit policy`, `Revoke`)
 * - "Create key" modal with Name, Per-call max (`$0.10`), Daily max (`$5.00`), Monthly max, Allowed hosts, Allowed sellers, Expires at → opens `<KeyReveal>` show-once dialog
 * - "Edit policy" modal updating limits in place
 * - "Revoke" confirmation dialog with in-flight call count note
 */

"use client";

import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import { DataTable } from "@/components/haggles/data-table";
import {
  KeyReveal,
  Money,
  PolicySummary,
  RelativeDate,
  StatusBadge,
  TruncatedId,
} from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type PortalAgentKey, portalApi } from "@/lib/portal-api";

export default function BuyerKeysPage() {
  const [keys, setKeys] = React.useState<PortalAgentKey[]>([]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [revealedKey, setRevealedKey] = React.useState<string | null>(null);
  const [editTarget, setEditTarget] = React.useState<PortalAgentKey | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<PortalAgentKey | null>(null);

  // Form fields
  const [name, setName] = React.useState("research-agent-prod");
  const [perCallMax, setPerCallMax] = React.useState("0.10");
  const [dailyMax, setDailyMax] = React.useState("5.00");
  const [monthlyMax, setMonthlyMax] = React.useState("50.00");
  const [allowedHosts, setAllowedHosts] = React.useState("");
  const [allowedSellers, setAllowedSellers] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const list = await portalApi.listBuyerKeys();
    setKeys(list);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreateModal = () => {
    setName("research-agent");
    setPerCallMax("0.10");
    setDailyMax("5.00");
    setMonthlyMax("50.00");
    setAllowedHosts("");
    setAllowedSellers("");
    setError(null);
    setCreateOpen(true);
  };

  const openEditModal = (key: PortalAgentKey) => {
    setEditTarget(key);
    setName(key.name);
    setPerCallMax(key.per_call_max);
    setDailyMax(key.daily_max);
    setMonthlyMax(key.monthly_max ?? "");
    setAllowedHosts((key.allowed_hosts ?? []).join(", "));
    setAllowedSellers((key.allowed_sellers ?? []).join(", "));
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const hosts = allowedHosts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const sellers = allowedSellers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const created = await portalApi.createBuyerKey({
        name,
        per_call_max: perCallMax,
        daily_max: dailyMax,
        monthly_max: monthlyMax.trim() || null,
        allowed_hosts: hosts.length > 0 ? hosts : null,
        allowed_sellers: sellers.length > 0 ? sellers : null,
      });
      setCreateOpen(false);
      setRevealedKey(created.key);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setError(null);
    try {
      const hosts = allowedHosts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const sellers = allowedSellers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await portalApi.updateBuyerKey(editTarget.id, {
        name,
        per_call_max: perCallMax,
        daily_max: dailyMax,
        monthly_max: monthlyMax.trim() || null,
        allowed_hosts: hosts.length > 0 ? hosts : null,
        allowed_sellers: sellers.length > 0 ? sellers : null,
      });
      setEditTarget(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update policy");
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    await portalApi.revokeBuyerKey(revokeTarget.id);
    setRevokeTarget(null);
    await refresh();
  };

  const columns = React.useMemo<ColDef<PortalAgentKey>[]>(
    () => [
      {
        headerName: "Name",
        field: "name",
        minWidth: 140,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<PortalAgentKey>) =>
          params.data ? (
            <div className="flex h-full items-center">
              <span className="font-medium text-foreground">{params.data.name}</span>
            </div>
          ) : null,
      },
      {
        headerName: "Prefix",
        field: "prefix",
        minWidth: 175,
        cellRenderer: (params: ICellRendererParams<PortalAgentKey>) =>
          params.data ? (
            <div className="flex h-full items-center">
              <TruncatedId value={`${params.data.prefix}…`} head={16} tail={0} />
            </div>
          ) : null,
      },
      {
        headerName: "Policy",
        field: "per_call_max",
        minWidth: 260,
        flex: 2,
        cellRenderer: (params: ICellRendererParams<PortalAgentKey>) =>
          params.data ? (
            <div className="flex h-full items-center min-w-0 overflow-hidden">
              <PolicySummary
                perCallMax={params.data.per_call_max}
                dailyMax={params.data.daily_max}
                monthlyMax={params.data.monthly_max}
                allowedHosts={params.data.allowed_hosts}
                allowedSellers={params.data.allowed_sellers}
              />
            </div>
          ) : null,
      },
      {
        headerName: "Spent today",
        field: "spent_today",
        minWidth: 110,
        cellRenderer: (params: ICellRendererParams<PortalAgentKey>) =>
          params.data ? (
            <div className="flex h-full items-center">
              <Money value={params.data.spent_today} />
            </div>
          ) : null,
      },
      {
        headerName: "Last used",
        field: "last_used_at",
        minWidth: 110,
        cellRenderer: (params: ICellRendererParams<PortalAgentKey>) =>
          params.data ? (
            <div className="flex h-full items-center">
              <RelativeDate iso={params.data.last_used_at} />
            </div>
          ) : null,
      },
      {
        headerName: "Status",
        field: "status",
        minWidth: 100,
        cellRenderer: (params: ICellRendererParams<PortalAgentKey>) =>
          params.data ? (
            <div className="flex h-full items-center">
              <StatusBadge status={params.data.status} />
            </div>
          ) : null,
      },
      {
        headerName: "Actions",
        field: "id",
        minWidth: 155,
        sortable: false,
        cellRenderer: (params: ICellRendererParams<PortalAgentKey>) => {
          const row = params.data;
          if (!row || row.status === "revoked") {
            return (
              <div className="flex h-full items-center">
                <span className="text-xs text-muted-foreground">Revoked</span>
              </div>
            );
          }
          return (
            <div className="flex h-full items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditModal(row);
                }}
                className="h-7 text-xs"
              >
                <IconEdit className="size-3.5" />
                Edit policy
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setRevokeTarget(row);
                }}
                className="h-7 w-7 p-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                title="Revoke key"
                aria-label="Revoke key"
              >
                <IconTrash className="size-3.5" />
              </Button>
            </div>
          );
        },
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Agent keys"
      description="Issue bearer keys with server-enforced per-call, daily, monthly, host, and seller spending caps."
      actions={
        <Button size="sm" onClick={openCreateModal}>
          <IconPlus className="size-3.5" />
          Create key
        </Button>
      }
    >
      <DataTable
        rowData={keys}
        columnDefs={columns}
        height={420}
        emptyText="No agent keys yet. Create a key to authorize autonomous HTTP 402 payments."
      />

      {/* Create / Edit modal */}
      {(createOpen || editTarget) ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="key-policy-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <form
            onSubmit={createOpen ? handleCreate : handleUpdate}
            className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
          >
            <h2 id="key-policy-modal-title" className="text-base font-semibold">
              {createOpen ? "Create agent key" : `Edit policy — ${editTarget?.name}`}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The facilitator enforces all policy caps inside the serializable ledger transaction before locking funds.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <Label htmlFor="key-name" className="text-xs">
                  Key name
                </Label>
                <Input
                  id="key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="per-call-max" className="text-xs">
                    Per-call max ($)
                  </Label>
                  <Input
                    id="per-call-max"
                    value={perCallMax}
                    onChange={(e) => setPerCallMax(e.target.value)}
                    required
                    className="mt-1 font-mono"
                  />
                </div>
                <div>
                  <Label htmlFor="daily-max" className="text-xs">
                    Daily max ($)
                  </Label>
                  <Input
                    id="daily-max"
                    value={dailyMax}
                    onChange={(e) => setDailyMax(e.target.value)}
                    required
                    className="mt-1 font-mono"
                  />
                </div>
                <div>
                  <Label htmlFor="monthly-max" className="text-xs">
                    Monthly max ($)
                  </Label>
                  <Input
                    id="monthly-max"
                    value={monthlyMax}
                    placeholder="Optional"
                    onChange={(e) => setMonthlyMax(e.target.value)}
                    className="mt-1 font-mono"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="allowed-hosts" className="text-xs">
                  Allowed hosts (comma-separated, blank = any)
                </Label>
                <Input
                  id="allowed-hosts"
                  value={allowedHosts}
                  placeholder="datasets.example.com, poems.example.com"
                  onChange={(e) => setAllowedHosts(e.target.value)}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <Label htmlFor="allowed-sellers" className="text-xs">
                  Allowed seller IDs (comma-separated, blank = any)
                </Label>
                <Input
                  id="allowed-sellers"
                  value={allowedSellers}
                  placeholder="slr_01J9Y8..."
                  onChange={(e) => setAllowedSellers(e.target.value)}
                  className="mt-1 font-mono text-xs"
                />
              </div>
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
                onClick={() => {
                  setCreateOpen(false);
                  setEditTarget(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit">
                {createOpen ? "Create key" : "Save policy"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Revoke confirmation dialog */}
      {revokeTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg">
            <h2 className="text-base font-semibold">
              Revoke key &ldquo;{revokeTarget.name}&rdquo;?
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Any new <code className="font-mono">/v1/pay</code> calls using{" "}
              <code className="font-mono">{revokeTarget.prefix}…</code> will immediately fail with{" "}
              <code className="font-mono">401 key_revoked</code>. In-flight authorizations already issued will complete or expire within 60 seconds.
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
        title="Agent key created — save your secret"
        envVarName="HAGGLES_KEY"
        fullKey={revealedKey}
        onClose={() => setRevealedKey(null)}
      />
    </AppShell>
  );
}
