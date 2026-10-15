"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { DateRangeFilter } from "@/components/data-table/date-range-filter";
import { LeadStatusBadge, PriorityBadge } from "@/components/shared/status-badge";
import {
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  SERVICE_CATEGORY_LABELS,
  options,
} from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { formatDate, relativeDays } from "@/lib/dates";
import type { LeadRow } from "@/server/leads/queries";

const columns: ColumnDef<LeadRow, unknown>[] = [
  {
    accessorKey: "leadNumber",
    meta: { label: "#" },
    header: ({ column }) => <ColumnHeader column={column} title="#" />,
    cell: ({ row }) => <span className="text-muted-foreground">L-{row.original.leadNumber}</span>,
  },
  {
    accessorKey: "name",
    meta: { label: "Name" },
    header: ({ column }) => <ColumnHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <div>
        <Link href={`/leads/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
        <p className="text-muted-foreground text-xs">
          {[row.original.phone, row.original.suburb].filter(Boolean).join(" · ")}
        </p>
      </div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "status",
    meta: { label: "Status" },
    header: ({ column }) => <ColumnHeader column={column} title="Status" />,
    cell: ({ row }) => (
      <div className="flex gap-1">
        <LeadStatusBadge status={row.original.status} />
        <PriorityBadge priority={row.original.urgency} />
      </div>
    ),
  },
  {
    accessorKey: "source",
    meta: { label: "Source" },
    header: ({ column }) => <ColumnHeader column={column} title="Source" />,
    cell: ({ row }) => (
      <div>
        <p>{LEAD_SOURCE_LABELS[row.original.source]}</p>
        {row.original.sourceDetail && (
          <p className="text-muted-foreground text-xs">{row.original.sourceDetail}</p>
        )}
      </div>
    ),
  },
  {
    id: "service",
    accessorFn: (r) => r.serviceCategory ?? "",
    meta: { label: "Service" },
    header: ({ column }) => <ColumnHeader column={column} title="Service" />,
    cell: ({ row }) =>
      row.original.serviceCategory ? SERVICE_CATEGORY_LABELS[row.original.serviceCategory] : "–",
  },
  {
    accessorKey: "estimatedValueCents",
    meta: { label: "Value" },
    header: ({ column }) => <ColumnHeader column={column} title="Value" />,
    cell: ({ row }) =>
      row.original.estimatedValueCents ? formatCents(row.original.estimatedValueCents) : "–",
  },
  {
    accessorKey: "assignedToId",
    meta: { label: "Assigned" },
    header: "Assigned",
    cell: ({ row }) =>
      row.original.assignedToName ?? <span className="text-muted-foreground">Unassigned</span>,
  },
  {
    accessorKey: "followUpAt",
    meta: { label: "Follow up" },
    sortingFn: "datetime",
    sortUndefined: "last",
    header: ({ column }) => <ColumnHeader column={column} title="Follow up" />,
    cell: ({ row }) => {
      const d = row.original.followUpAt;
      if (!d) return "–";
      const overdue = d.getTime() < Date.now() && !["WON", "LOST"].includes(row.original.status);
      return (
        <span className={overdue ? "text-destructive font-medium" : undefined}>
          {relativeDays(d)}
        </span>
      );
    },
  },
  {
    accessorKey: "createdAt",
    meta: { label: "Received" },
    sortingFn: "datetime",
    header: ({ column }) => <ColumnHeader column={column} title="Received" />,
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

export function LeadsTable({
  data,
  staff,
}: {
  data: LeadRow[];
  staff: { value: string; label: string }[];
}) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search name, phone, email, suburb…"
      searchText={(r) =>
        [
          `L-${r.leadNumber}`,
          r.name,
          r.email,
          r.phone,
          r.phone?.replace(/\D/g, ""),
          r.suburb,
          r.message,
          r.brand,
        ].join(" ")
      }
      filters={[
        { columnId: "status", title: "Status", options: options(LEAD_STATUS_LABELS) },
        { columnId: "source", title: "Source", options: options(LEAD_SOURCE_LABELS) },
        { columnId: "service", title: "Service", options: options(SERVICE_CATEGORY_LABELS) },
        {
          columnId: "assignedToId",
          title: "Assigned",
          options: [...staff, { value: "unassigned", label: "Unassigned" }],
        },
      ]}
      toolbar={<DateRangeFilter label="Received" />}
      getRowHref={(r) => `/leads/${r.id}`}
      initialSort={{ id: "createdAt", desc: true }}
      emptyMessage="No leads match these filters."
    />
  );
}
