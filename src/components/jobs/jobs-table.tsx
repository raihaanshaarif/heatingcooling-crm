"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { JobStatusBadge, PriorityBadge } from "@/components/shared/status-badge";
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, PRIORITY_LABELS, options } from "@/lib/labels";
import { formatDateTime } from "@/lib/dates";
import type { JobRow } from "@/server/jobs/queries";

const columns: ColumnDef<JobRow, unknown>[] = [
  {
    accessorKey: "number",
    meta: { label: "Number" },
    header: ({ column }) => <ColumnHeader column={column} title="Job" />,
    cell: ({ row }) => (
      <Link href={`/jobs/${row.original.id}`} className="font-medium hover:underline">
        {row.original.number}
      </Link>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "title",
    meta: { label: "Title" },
    header: "Title",
    cell: ({ row }) => <div className="max-w-72 truncate">{row.original.title}</div>,
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
    accessorKey: "type",
    meta: { label: "Type" },
    header: "Type",
    cell: ({ row }) => JOB_TYPE_LABELS[row.original.type],
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "status",
    meta: { label: "Status" },
    header: ({ column }) => <ColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <JobStatusBadge status={row.original.status} />,
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "priority",
    meta: { label: "Priority" },
    header: "Priority",
    cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
  },
  {
    id: "technician",
    accessorFn: (r) => r.technicianIds,
    meta: { label: "Technicians" },
    header: "Technicians",
    cell: ({ row }) =>
      row.original.technicians.length ? (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {row.original.technicians.map((t) => (
            <span key={t.name} className="inline-flex items-center gap-1 text-sm">
              <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name.split(" ")[0]}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground">Unassigned</span>
      ),
    filterFn: (row, id, value: string[]) =>
      (row.getValue(id) as string[]).some((t) => value.includes(t)),
    enableSorting: false,
  },
  {
    accessorKey: "scheduledStart",
    meta: { label: "Scheduled" },
    sortingFn: "datetime",
    sortUndefined: "last",
    header: ({ column }) => <ColumnHeader column={column} title="Scheduled" />,
    cell: ({ row }) =>
      row.original.scheduledStart ? (
        formatDateTime(row.original.scheduledStart)
      ) : (
        <span className="text-muted-foreground">Unscheduled</span>
      ),
  },
];

export function JobsTable({
  data,
  technicians,
}: {
  data: JobRow[];
  technicians: { value: string; label: string }[];
}) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search number, title, client, suburb…"
      searchText={(r) => [r.number, r.title, r.clientName, r.suburb].join(" ")}
      filters={[
        { columnId: "status", title: "Status", options: options(JOB_STATUS_LABELS) },
        { columnId: "type", title: "Type", options: options(JOB_TYPE_LABELS) },
        { columnId: "technician", title: "Technician", options: technicians },
        { columnId: "priority", title: "Priority", options: options(PRIORITY_LABELS) },
      ]}
      getRowHref={(r) => `/jobs/${r.id}`}
      initialSort={{ id: "scheduledStart", desc: true }}
      initialHidden={["priority"]}
      emptyMessage="No jobs match."
    />
  );
}
