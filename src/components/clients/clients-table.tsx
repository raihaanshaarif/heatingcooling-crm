"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { CLIENT_TAGS, CLIENT_TYPE_LABELS, options } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { ClientRow } from "@/server/clients/queries";

const columns: ColumnDef<ClientRow, unknown>[] = [
  {
    accessorKey: "name",
    meta: { label: "Name" },
    header: ({ column }) => <ColumnHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <div className="min-w-0">
        <Link href={`/clients/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
        {row.original.companyName && (
          <p className="text-muted-foreground text-xs">{row.original.companyName}</p>
        )}
      </div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "type",
    meta: { label: "Type" },
    header: ({ column }) => <ColumnHeader column={column} title="Type" />,
    cell: ({ row }) => <span className="text-sm">{CLIENT_TYPE_LABELS[row.original.type]}</span>,
  },
  { accessorKey: "phone", meta: { label: "Phone" }, header: "Phone", enableSorting: false },
  { accessorKey: "email", meta: { label: "Email" }, header: "Email", enableSorting: false },
  {
    accessorKey: "suburb",
    meta: { label: "Suburb" },
    header: ({ column }) => <ColumnHeader column={column} title="Suburb" />,
  },
  {
    accessorKey: "tags",
    meta: { label: "Tags" },
    header: "Tags",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.doNotService && <Badge variant="destructive">Do not service</Badge>}
        {row.original.tags
          .filter((t) => t !== "Do not service")
          .map((t) => (
            <Badge
              key={t}
              variant={t === "VIP" ? "violet" : t === "Slow payer" ? "warning" : "secondary"}
            >
              {t}
            </Badge>
          ))}
      </div>
    ),
  },
  {
    accessorKey: "propertyCount",
    meta: { label: "Properties" },
    header: ({ column }) => <ColumnHeader column={column} title="Properties" />,
  },
  {
    accessorKey: "jobCount",
    meta: { label: "Jobs" },
    header: ({ column }) => <ColumnHeader column={column} title="Jobs" />,
  },
  {
    accessorKey: "outstandingCents",
    meta: { label: "Outstanding" },
    header: ({ column }) => <ColumnHeader column={column} title="Outstanding" />,
    cell: ({ row }) =>
      row.original.outstandingCents > 0 ? (
        <span className="font-medium tabular-nums">
          {formatCents(row.original.outstandingCents)}
        </span>
      ) : (
        <span className="text-muted-foreground">–</span>
      ),
  },
  {
    accessorKey: "createdAt",
    meta: { label: "Added" },
    header: ({ column }) => <ColumnHeader column={column} title="Added" />,
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

export function ClientsTable({ data }: { data: ClientRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search name, phone, email, suburb…"
      searchText={(r) =>
        [
          r.name,
          r.companyName,
          r.email,
          r.phone,
          r.phone?.replace(/\D/g, ""),
          r.suburb,
          ...r.tags,
        ].join(" ")
      }
      filters={[
        { columnId: "type", title: "Type", options: options(CLIENT_TYPE_LABELS) },
        {
          columnId: "tags",
          title: "Tags",
          options: CLIENT_TAGS.map((t) => ({ value: t, label: t })),
        },
      ]}
      getRowHref={(r) => `/clients/${r.id}`}
      initialSort={{ id: "name", desc: false }}
      initialHidden={["email", "createdAt"]}
      emptyMessage="No clients match."
    />
  );
}
