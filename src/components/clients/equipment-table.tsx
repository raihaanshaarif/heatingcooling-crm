"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { ExpiryBadge } from "@/components/shared/status-badge";
import { BRANDS, EQUIPMENT_TYPE_LABELS, options } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import type { EquipmentRow } from "@/server/equipment/queries";

type Row = EquipmentRow & { warranty: "expired" | "expiring" | "valid" | "none" };

const columns: ColumnDef<Row, unknown>[] = [
  {
    id: "unit",
    accessorFn: (r) => `${r.brand} ${r.model ?? ""}`,
    meta: { label: "Unit" },
    header: ({ column }) => <ColumnHeader column={column} title="Unit" />,
    cell: ({ row }) => (
      <div>
        <Link href={`/equipment/${row.original.id}`} className="font-medium hover:underline">
          {row.original.brand} {row.original.model}
        </Link>
        {row.original.serialNumber && (
          <p className="text-muted-foreground text-xs">S/N {row.original.serialNumber}</p>
        )}
      </div>
    ),
    enableHiding: false,
  },
  { accessorKey: "brand", meta: { label: "Brand" }, header: "Brand" },
  {
    accessorKey: "type",
    meta: { label: "Type" },
    header: ({ column }) => <ColumnHeader column={column} title="Type" />,
    cell: ({ row }) => EQUIPMENT_TYPE_LABELS[row.original.type],
  },
  {
    accessorKey: "capacityKw",
    meta: { label: "kW" },
    header: ({ column }) => <ColumnHeader column={column} title="kW" />,
    cell: ({ row }) => row.original.capacityKw ?? "–",
  },
  {
    accessorKey: "refrigerant",
    meta: { label: "Refrigerant" },
    header: "Gas",
    cell: ({ row }) => row.original.refrigerant ?? "–",
  },
  {
    accessorKey: "clientName",
    meta: { label: "Client" },
    header: ({ column }) => <ColumnHeader column={column} title="Client" />,
    cell: ({ row }) => (
      <Link href={`/clients/${row.original.clientId}`} className="hover:underline">
        {row.original.clientName}
      </Link>
    ),
  },
  {
    accessorKey: "suburb",
    meta: { label: "Suburb" },
    header: ({ column }) => <ColumnHeader column={column} title="Suburb" />,
  },
  {
    accessorKey: "lastServicedAt",
    meta: { label: "Last service" },
    header: ({ column }) => <ColumnHeader column={column} title="Last service" />,
    sortingFn: "datetime",
    cell: ({ row }) =>
      row.original.lastServicedAt ? formatDate(row.original.lastServicedAt) : "Never",
  },
  {
    accessorKey: "warranty",
    meta: { label: "Warranty" },
    header: "Warranty",
    cell: ({ row }) => <ExpiryBadge date={row.original.warrantyExpiresAt} />,
  },
];

export function EquipmentTable({ data }: { data: EquipmentRow[] }) {
  const now = Date.now();
  const rows: Row[] = data.map((e) => {
    if (!e.warrantyExpiresAt) return { ...e, warranty: "none" };
    const days = (e.warrantyExpiresAt.getTime() - now) / 86_400_000;
    return { ...e, warranty: days < 0 ? "expired" : days <= 30 ? "expiring" : "valid" };
  });
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search brand, model, serial, client…"
      searchText={(r) =>
        [r.brand, r.model, r.serialNumber, r.clientName, r.suburb, r.address, r.location].join(" ")
      }
      filters={[
        { columnId: "brand", title: "Brand", options: BRANDS.map((b) => ({ value: b, label: b })) },
        { columnId: "type", title: "Type", options: options(EQUIPMENT_TYPE_LABELS) },
        {
          columnId: "warranty",
          title: "Warranty",
          options: [
            { value: "expiring", label: "Expiring in 30 days" },
            { value: "expired", label: "Expired" },
            { value: "valid", label: "Valid" },
            { value: "none", label: "No warranty date" },
          ],
        },
      ]}
      initialHidden={["brand"]}
      getRowHref={(r) => `/equipment/${r.id}`}
      initialSort={{ id: "unit", desc: false }}
      emptyMessage="No equipment matches."
    />
  );
}
