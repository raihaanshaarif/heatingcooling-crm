"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { DateRangeFilter } from "@/components/data-table/date-range-filter";
import { PAYMENT_METHOD_LABELS, options } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { PaymentRow } from "@/server/payments/queries";

const columns: ColumnDef<PaymentRow, unknown>[] = [
  {
    accessorKey: "paidAt",
    meta: { label: "Date" },
    sortingFn: "datetime",
    header: ({ column }) => <ColumnHeader column={column} title="Date" />,
    cell: ({ row }) => formatDate(row.original.paidAt),
    enableHiding: false,
  },
  {
    accessorKey: "invoiceNumber",
    meta: { label: "Invoice" },
    header: ({ column }) => <ColumnHeader column={column} title="Invoice" />,
    cell: ({ row }) => (
      <Link href={`/invoices/${row.original.invoiceId}`} className="font-medium hover:underline">
        {row.original.invoiceNumber}
      </Link>
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
    accessorKey: "method",
    meta: { label: "Method" },
    header: "Method",
    cell: ({ row }) => PAYMENT_METHOD_LABELS[row.original.method],
  },
  {
    accessorKey: "reference",
    meta: { label: "Reference" },
    header: "Reference",
    cell: ({ row }) => row.original.reference ?? "–",
  },
  {
    accessorKey: "recordedBy",
    meta: { label: "Recorded by" },
    header: "Recorded by",
    cell: ({ row }) => row.original.recordedBy ?? "–",
  },
  {
    accessorKey: "amountCents",
    meta: { label: "Amount" },
    header: ({ column }) => <ColumnHeader column={column} title="Amount" className="justify-end" />,
    cell: ({ row }) => (
      <div
        className={
          row.original.amountCents < 0
            ? "text-destructive text-right tabular-nums"
            : "text-right tabular-nums"
        }
      >
        {formatCents(row.original.amountCents)}
      </div>
    ),
  },
];

export function PaymentsTable({ data }: { data: PaymentRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search invoice, client, reference…"
      searchText={(r) => [r.invoiceNumber, r.clientName, r.reference].join(" ")}
      filters={[{ columnId: "method", title: "Method", options: options(PAYMENT_METHOD_LABELS) }]}
      toolbar={<DateRangeFilter label="Paid" />}
      getRowHref={(r) => `/invoices/${r.invoiceId}`}
      initialSort={{ id: "paidAt", desc: true }}
      initialHidden={["recordedBy"]}
      emptyMessage="No payments in this period."
    />
  );
}
