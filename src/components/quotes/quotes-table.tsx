"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { QuoteStatusBadge } from "@/components/shared/status-badge";
import { QUOTE_STATUS_LABELS, options } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { QuoteRow } from "@/server/quotes/queries";

const columns: ColumnDef<QuoteRow, unknown>[] = [
  {
    accessorKey: "number",
    meta: { label: "Number" },
    header: ({ column }) => <ColumnHeader column={column} title="Quote" />,
    cell: ({ row }) => (
      <Link href={`/quotes/${row.original.id}`} className="font-medium hover:underline">
        {row.original.number}
      </Link>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "title",
    meta: { label: "Title" },
    header: "Title",
    cell: ({ row }) => (
      <div className="max-w-72 truncate">
        {row.original.title}
        {row.original.optionCount > 1 && (
          <span className="text-muted-foreground"> · {row.original.optionCount} options</span>
        )}
      </div>
    ),
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
    header: "Suburb",
    cell: ({ row }) => row.original.suburb ?? "–",
  },
  {
    accessorKey: "status",
    meta: { label: "Status" },
    header: ({ column }) => <ColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <QuoteStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "totalCents",
    meta: { label: "Total" },
    header: ({ column }) => <ColumnHeader column={column} title="Total inc GST" />,
    cell: ({ row }) => <span className="tabular-nums">{formatCents(row.original.totalCents)}</span>,
  },
  {
    accessorKey: "createdAt",
    meta: { label: "Created" },
    sortingFn: "datetime",
    header: ({ column }) => <ColumnHeader column={column} title="Created" />,
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
  {
    accessorKey: "validUntil",
    meta: { label: "Valid until" },
    sortingFn: "datetime",
    header: ({ column }) => <ColumnHeader column={column} title="Valid until" />,
    cell: ({ row }) => (row.original.validUntil ? formatDate(row.original.validUntil) : "–"),
  },
];

export function QuotesTable({ data }: { data: QuoteRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search number, title, client…"
      searchText={(r) => [r.number, r.title, r.clientName, r.suburb].join(" ")}
      filters={[{ columnId: "status", title: "Status", options: options(QUOTE_STATUS_LABELS) }]}
      getRowHref={(r) => `/quotes/${r.id}`}
      initialSort={{ id: "createdAt", desc: true }}
      emptyMessage="No quotes match."
    />
  );
}
