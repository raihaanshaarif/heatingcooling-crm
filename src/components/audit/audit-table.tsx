"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { DateRangeFilter } from "@/components/data-table/date-range-filter";
import { formatDateTime } from "@/lib/dates";

export interface AuditRow {
  id: string;
  createdAt: Date;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  href: string | null;
  changes: string | null;
}

function Changes({ json }: { json: string | null }) {
  if (!json || json === "{}" || json === "null")
    return <span className="text-muted-foreground">–</span>;
  return (
    <details className="max-w-md">
      <summary className="text-muted-foreground cursor-pointer text-xs">View</summary>
      <pre className="bg-muted mt-1 max-h-60 overflow-auto rounded p-2 text-[11px] whitespace-pre-wrap">
        {json}
      </pre>
    </details>
  );
}

const columns: ColumnDef<AuditRow, unknown>[] = [
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
  { accessorKey: "userName", meta: { label: "User" }, header: "User" },
  {
    accessorKey: "action",
    meta: { label: "Action" },
    header: "Action",
    cell: ({ row }) => <Badge variant="secondary">{row.original.action}</Badge>,
  },
  { accessorKey: "entityType", meta: { label: "Record" }, header: "Record" },
  {
    accessorKey: "entityId",
    meta: { label: "ID" },
    header: "ID",
    cell: ({ row }) =>
      row.original.href ? (
        <a href={row.original.href} className="font-mono text-xs hover:underline">
          {row.original.entityId.slice(-8)}
        </a>
      ) : (
        <span className="font-mono text-xs">{row.original.entityId.slice(-8)}</span>
      ),
  },
  {
    accessorKey: "changes",
    meta: { label: "Changes" },
    header: "Changes",
    enableSorting: false,
    cell: ({ row }) => <Changes json={row.original.changes} />,
  },
];

export function AuditTable({
  data,
  users,
  actions,
  entities,
}: {
  data: AuditRow[];
  users: string[];
  actions: string[];
  entities: string[];
}) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search user, record id, changes…"
      searchText={(r) => [r.userName, r.action, r.entityType, r.entityId, r.changes].join(" ")}
      filters={[
        {
          columnId: "userName",
          title: "User",
          options: users.map((u) => ({ value: u, label: u })),
        },
        {
          columnId: "action",
          title: "Action",
          options: actions.map((a) => ({ value: a, label: a })),
        },
        {
          columnId: "entityType",
          title: "Record",
          options: entities.map((e) => ({ value: e, label: e })),
        },
      ]}
      toolbar={<DateRangeFilter label="Date" />}
      initialSort={{ id: "createdAt", desc: true }}
      pageSize={50}
      emptyMessage="No audit entries."
    />
  );
}
