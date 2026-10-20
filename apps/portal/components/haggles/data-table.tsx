/**
 * `<DataTable>` built on AG Grid Community (`ag-grid-react` + `ag-grid-community`)
 * implementing all 4 required states (loading skeletons, empty state, error alert with retry, populated)
 * and cursor/page navigation (SPEC.md sections 3.4, 11.1, and 16.3).
 */

"use client";

import {
  AllCommunityModule,
  type ColDef,
  ModuleRegistry,
  type RowClickedEvent,
  themeQuartz,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./primitives";

ModuleRegistry.registerModules([AllCommunityModule]);

const hagglesGridTheme = themeQuartz.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--card-foreground)",
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--muted-foreground)",
  borderColor: "var(--border)",
  rowHoverColor: "var(--accent)",
  fontFamily: "var(--font-sans), sans-serif",
  fontSize: 12,
  headerFontSize: 11,
  headerFontWeight: 600,
  cellHorizontalPadding: 12,
});

export interface DataTableProps<T extends object> {
  /** Rows to display */
  rows?: T[] | undefined;
  /** Alias for rows */
  rowData?: T[] | undefined;
  /** AG Grid column definitions */
  columns?: ColDef<T>[] | undefined;
  /** Alias for columns */
  columnDefs?: ColDef<T>[] | undefined;
  /** Optional explicit container height */
  height?: number | undefined;
  /** Whether data is currently loading */
  loading?: boolean | undefined;
  /** Optional error message to show inline with Retry button */
  error?: string | null | undefined;
  /** Retry callback when `error` is present */
  onRetry?: (() => void) | undefined;
  /** Title shown when `rows.length === 0` */
  emptyTitle?: string | undefined;
  /** Description shown when `rows.length === 0` */
  emptyDescription?: string | undefined;
  /** Shorthand empty text */
  emptyText?: string | undefined;
  /** Primary action shown inside the empty state */
  emptyAction?: React.ReactNode | undefined;
  /** Optional callback invoked when a row is clicked */
  onRowClick?: ((row: T) => void) | undefined;
  /** Alias for onRowClick */
  onRowClicked?: ((row: T) => void) | undefined;
  /** Page size for pagination (default 25 per SPEC.md section 11.4) */
  pageSize?: number | undefined;
  /** Accessible label for the data grid */
  ariaLabel?: string | undefined;
}

/**
 * Reusable AG Grid Community `<DataTable>` component implementing loading, empty, error, and populated states
 * (`SPEC.md` section 11.1).
 *
 * @example
 * ```tsx
 * <DataTable rows={payments} columns={cols} emptyTitle="No payments yet" emptyDescription="..." />
 * ```
 */
export function DataTable<T extends object>({
  rows: rowsProp,
  rowData,
  columns: columnsProp,
  columnDefs,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = "No records found",
  emptyDescription,
  emptyText,
  emptyAction,
  onRowClick,
  onRowClicked,
  pageSize = 25,
  ariaLabel = "Data table",
}: DataTableProps<T>) {
  const rows = rowsProp ?? rowData ?? [];
  const columns = columnsProp ?? columnDefs ?? [];
  const resolvedEmptyDescription =
    emptyDescription ?? emptyText ?? "Records will appear here once activity starts.";
  const resolvedOnRowClick = onRowClick ?? onRowClicked;
  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading table data"
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        <div className="border-b border-border bg-muted/60 px-4 py-2.5">
          <div className="h-3.5 w-48 animate-pulse rounded bg-muted-foreground/20" />
        </div>
        <div className="divide-y divide-border">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-44 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-20 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-16 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive"
      >
        <span>{error}</span>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={resolvedEmptyDescription}
        action={emptyAction}
      />
    );
  }

  const handleRowClicked = (event: RowClickedEvent<T>) => {
    if (resolvedOnRowClick && event.data) {
      resolvedOnRowClick(event.data);
    }
  };

  return (
    <div
      aria-label={ariaLabel}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="w-full">
        <AgGridReact<T>
          theme={hagglesGridTheme}
          rowData={rows}
          columnDefs={columns}
          domLayout="autoHeight"
          pagination={rows.length > pageSize}
          paginationPageSize={pageSize}
          paginationPageSizeSelector={[10, 25, 50]}
          suppressCellFocus={false}
          onRowClicked={handleRowClicked}
          rowClass={resolvedOnRowClick ? "cursor-pointer" : undefined}
          defaultColDef={{
            sortable: true,
            resizable: true,
            flex: 1,
            minWidth: 100,
          }}
        />
      </div>
    </div>
  );
}
