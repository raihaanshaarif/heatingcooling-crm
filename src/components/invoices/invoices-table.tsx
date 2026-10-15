"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { InvoiceStatusBadge } from "@/components/shared/status-badge";
import { INVOICE_STATUS_LABELS, options } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { InvoiceRow } from "@/server/invoices/queries";

const columns: ColumnDef<InvoiceRow, unknown>[] = [
  {
    accessorKey: "number",
    meta: { label: "Number" },
    header: ({ column }) => <ColumnHeader column={column} title="Invoice" />,
    cell: ({ row }) => (
      <Link href={`/invoices/${row.original.id}`} className="font-medium hover:underline">
        {row.original.number}
      </Link>
    ),
    enableHiding: false,
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
    accessorKey: "jobNumber",
    meta: { label: "Job" },
    header: "Job",
    cell: ({ row }) =>
      row.original.jobId ? (
        <Link href={`/jobs/${row.original.jobId}`} className="hover:underline">
          {row.original.jobNumber}
        </Link>
      ) : (
        "–"
      ),
  },
  {
    accessorKey: "status",
    meta: { label: "Status" },
    header: ({ column }) => <ColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "issueDate",
    meta: { label: "Issued" },
    sortingFn: "datetime",
    header: ({ column }) => <ColumnHeader column={column} title="Issued" />,
    cell: ({ row }) => formatDate(row.original.issueDate),
  },
  {
    accessorKey: "dueDate",
    meta: { label: "Due" },
    sortingFn: "datetime",
    header: ({ column }) => <ColumnHeader column={column} title="Due" />,
    cell: ({ row }) => formatDate(row.original.dueDate),
  },
  {
    accessorKey: "totalCents",
    meta: { label: "Total" },
    header: ({ column }) => <ColumnHeader column={column} title="Total" className="justify-end" />,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{formatCents(row.original.totalCents)}</div>
    ),
  },
  {
    accessorKey: "balanceCents",
    meta: { label: "Balance" },
    header: ({ column }) => (
      <ColumnHeader column={column} title="Balance" className="justify-end" />
    ),
    cell: ({ row }) => (
      <div className="text-right font-medium tabular-nums">
        {row.original.status === "VOID" ? "–" : formatCents(row.original.balanceCents)}
      </div>
    ),
  },
];

export function InvoicesTable({ data }: { data: InvoiceRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search number, client, job…"
      searchText={(r) => [r.number, r.clientName, r.jobNumber].join(" ")}
      filters={[{ columnId: "status", title: "Status", options: options(INVOICE_STATUS_LABELS) }]}
      getRowHref={(r) => `/invoices/${r.id}`}
      initialSort={{ id: "issueDate", desc: true }}
      emptyMessage="No invoices match."
    />
  );
}
