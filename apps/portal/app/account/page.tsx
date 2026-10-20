/**
 * Account settings page (`/account` — SPEC.md section 11.6).
 *
 * Profile (display name, read-only PayPal email and payer ID), Buyer/Seller role switches
 * (with non-zero balance guard), "Sign out all sessions", environment info, and Danger Zone.
 */

"use client";

import * as React from "react";
import { AppShell } from "@/components/haggles/app-shell";
import { StatusBadge, TruncatedId } from "@/components/haggles/primitives";
import { Button } from "@/components/ui/button";
import {
  type PortalAccountProfile,
  portalApi,
} from "@/lib/portal-api";

export default function AccountPage() {
  const [account, setAccount] = React.useState<PortalAccountProfile | null>(null);
  const [displayName, setDisplayName] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void portalApi.getMe().then((me) => {
      setAccount(me);
      setDisplayName(me.display_name ?? "");
    });
  }, []);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const updated = await portalApi.updateMe({ display_name: displayName });
      setAccount(updated);
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update profile.");
    }
  };

  const handleToggleRole = async (role: "is_buyer" | "is_seller", nextVal: boolean) => {
    setError(null);
    setMessage(null);
    try {
      const updated = await portalApi.updateMe({ [role]: nextVal });
      setAccount(updated);
      setMessage("Role settings updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change role while balance is non-zero.");
    }
  };

  const handleRevokeSessions = async () => {
    setError(null);
    await portalApi.updateMe({ revoke_all_sessions: true });
    setMessage("Signed out of all other active sessions.");
  };

  return (
    <AppShell title="Account" section="Account">
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive"
        >
          {error}
        </div>
      ) : null}
      {message ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300"
        >
          {message}
        </div>
      ) : null}

      {/* Profile card */}
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Profile &amp; PayPal Identity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Linked via Log in with PayPal. Your PayPal <code className="font-mono">payer_id</code> is used for seller
          payouts.
        </p>

        <form onSubmit={handleSaveName} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="display-name" className="block text-xs font-medium text-muted-foreground">
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              PayPal email (read-only)
            </label>
            <input
              type="email"
              readOnly
              value={account?.email ?? ""}
              className="mt-1 w-full rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"
            />
          </div>

          <div>
            <div className="text-xs font-medium text-muted-foreground">PayPal Payer ID</div>
            <div className="mt-1.5 flex items-center gap-2">
              {account?.paypal_payer_id ? (
                <TruncatedId value={account.paypal_payer_id} head={6} tail={4} />
              ) : null}
              {account?.paypal_verified_account ? (
                <StatusBadge status="active" />
              ) : null}
            </div>
          </div>

          <div className="flex items-end justify-end">
            <Button type="submit" variant="default" size="default">
              Save profile
            </Button>
          </div>
        </form>
      </section>

      {/* Roles card */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Account roles</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Enable or disable Buyer and Seller sections. Roles with a non-zero balance cannot be disabled.
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <div>
            <div className="text-xs font-semibold">Buyer role</div>
            <div className="text-xs text-muted-foreground">
              Prepaid wallet (<code className="font-mono">{account?.wallet_id ?? "not provisioned"}</code>) and AI agent
              spending keys.
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={account?.is_buyer ?? true}
              onChange={(e) => handleToggleRole("is_buyer", e.target.checked)}
              className="size-4 accent-primary"
            />
            <span>{account?.is_buyer ? "Enabled" : "Disabled"}</span>
          </label>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <div>
            <div className="text-xs font-semibold">Seller role</div>
            <div className="text-xs text-muted-foreground">
              Paywall middleware (<code className="font-mono">{account?.seller_id ?? "not provisioned"}</code>) and
              automatic PayPal payouts.
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={account?.is_seller ?? true}
              onChange={(e) => handleToggleRole("is_seller", e.target.checked)}
              className="size-4 accent-primary"
            />
            <span>{account?.is_seller ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
      </section>

      {/* Environment & Sessions */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Environment</h2>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Facilitator URL</dt>
              <dd className="font-mono">{account?.environment.public_api_url ?? "http://localhost:3001"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Haggles environment</dt>
              <dd className="font-mono">{account?.environment.haggles_env ?? "test"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">PayPal mode</dt>
              <dd className="font-mono">{account?.environment.paypal_mode ?? "sandbox"}</dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col justify-between rounded-lg border border-border bg-card p-5">
          <div>
            <h2 className="text-sm font-semibold">Active sessions</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sessions use 7-day sliding and 30-day absolute expiry with HttpOnly cookies and double-submit CSRF tokens.
            </p>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="default" onClick={handleRevokeSessions}>
              Sign out all sessions
            </Button>
          </div>
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-lg border border-destructive/30 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Account deletion is disabled while any wallet balance or pending seller payout exists.
            </p>
          </div>
          <Button variant="destructive" size="default" disabled title="Empty wallet and pending payouts before deleting account">
            Delete account
          </Button>
        </div>
      </section>
    </AppShell>
  );
}
