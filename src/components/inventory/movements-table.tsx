"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import type { StockMovementType } from "@prisma/client";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { formatDateTime } from "@/lib/dates";
import { formatQty } from "@/lib/inventory";
import { STOCK_MOVEMENT_LABELS, options } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import type { LocationOption, MovementRow } from "@/server/inventory/queries";

const TYPE_VARIANT: Record<StockMovementType, BadgeVariant> = {
  RECEIVE: "success",
  TRANSFER: "info",
  ADJUST: "warning",
  JOB_USE: "violet",
  JOB_RETURN: "muted",
};

export function MovementTypeBadge({ type }: { type: StockMovementType }) {
  return <Badge variant={TYPE_VARIANT[type]}>{STOCK_MOVEMENT_LABELS[type]}</Badge>;
}

/** The stock ledger: every receipt, transfer, adjustment and job usage, newest first. */
export function MovementsTable({
  data,
  locations,
  showCosts,
}: {
  data: MovementRow[];
  locations: LocationOption[];
  showCosts: boolean;
}) {
  const columns: ColumnDef<MovementRow, unknown>[] = [
    {
      accessorKey: "createdAt",
      meta: { label: "When" },
      sortingFn: "datetime",
      header: ({ column }) => <ColumnHeader column={column} title="When" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{formatDateTime(row.original.createdAt)}</span>
      ),
      enableHiding: false,
    },
    {
      accessorKey: "type",
      meta: { label: "Type" },
      header: "Type",
      cell: ({ row }) => <MovementTypeBadge type={row.original.type} />,
    },
    {
      accessorKey: "itemName",
      meta: { label: "Item" },
      header: ({ column }) => <ColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <div className="max-w-64 min-w-0 whitespace-normal">
          {row.original.itemName}
          {row.original.sku && (
            <span className="text-muted-foreground block text-xs">{row.original.sku}</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "quantity",
      meta: { label: "Qty" },
      header: ({ column }) => <ColumnHeader column={column} title="Qty" />,
      cell: ({ row }) => (
        <span className="tabular-nums">{formatQty(row.original.quantity, row.original.unit)}</span>
      ),
    },
    {
      id: "location",
      accessorFn: (r) => r.locationIds,
      meta: { label: "From → to" },
      header: "From → to",
      enableSorting: false,
      cell: ({ row }) => {
        const m = row.original;
        if (m.type === "ADJUST")
          return (
            <span className="text-sm whitespace-nowrap">
              {m.to ? `${m.to.name} (added)` : `${m.from?.name ?? "–"} (removed)`}
            </span>
          );
        return (
          <span className="text-sm whitespace-nowrap">
            {m.from?.name ?? (m.type === "RECEIVE" ? "Supplier" : "–")}
            {" → "}
            {m.to?.name ?? (m.type === "JOB_USE" ? "Job" : "–")}
          </span>
        );
      },
    },
    {
      id: "detail",
      meta: { label: "Detail" },
      header: "Detail",
      enableSorting: false,
      cell: ({ row }) => {
        const m = row.original;
        return (
          <div className="max-w-72 min-w-0 text-sm whitespace-normal">
            {m.job && (
              <Link href={`/jobs/${m.job.id}`} className="font-medium hover:underline">
                {m.job.number}
              </Link>
            )}
            {m.supplierName && <span>{m.supplierName}</span>}
            {m.reference && <span className="text-muted-foreground"> · {m.reference}</span>}
            {m.reason && m.type !== "RECEIVE" && (
              <span className="text-muted-foreground block text-xs">{m.reason}</span>
            )}
          </div>
        );
      },
    },
    ...(showCosts
      ? ([
          {
            accessorKey: "unitCostCents",
            meta: { label: "Unit cost" },
            header: "Unit cost",
            cell: ({ row }) =>
              row.original.unitCostCents === null ? (
                "–"
              ) : (
                <span className="tabular-nums">{formatCents(row.original.unitCostCents)}</span>
              ),
          },
        ] satisfies ColumnDef<MovementRow, unknown>[])
      : []),
    {
      accessorKey: "userName",
      meta: { label: "By" },
      header: "By",
      cell: ({ row }) => row.original.userName ?? "System",
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={data}
      urlKey="mv_"
      searchPlaceholder="Search item, job, supplier, reason…"
      searchText={(r) =>
        [r.itemName, r.sku, r.job?.number, r.supplierName, r.reference, r.reason, r.userName].join(
          " ",
        )
      }
      filters={[
        { columnId: "type", title: "Type", options: options(STOCK_MOVEMENT_LABELS) },
        {
          columnId: "location",
          title: "Location",
          options: locations.map((l) => ({ value: l.id, label: l.name })),
        },
      ]}
      initialSort={{ id: "createdAt", desc: true }}
      pageSize={50}
      emptyMessage="No stock movements yet."
    />
  );
}
