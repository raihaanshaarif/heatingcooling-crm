"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { ExpiryBadge } from "@/components/shared/status-badge";
import { LICENCE_TYPE_LABELS, ROLE_LABELS, options } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { formatMinutes } from "@/lib/dates";
import { formatPhoneAU } from "@/lib/utils";
import type { TeamRow } from "@/server/team/queries";

export function TeamTable({ data, showCosts }: { data: TeamRow[]; showCosts: boolean }) {
  const columns: ColumnDef<TeamRow, unknown>[] = [
    {
      accessorKey: "name",
      meta: { label: "Name" },
      header: ({ column }) => <ColumnHeader column={column} title="Name" />,
      cell: ({ row }) => (
        <Link
          href={`/team/${row.original.id}`}
          className="inline-flex items-center gap-2 font-medium hover:underline"
        >
          <span className="size-2.5 rounded-full" style={{ backgroundColor: row.original.color }} />
          {row.original.name}
          {!row.original.active && <Badge variant="muted">Inactive</Badge>}
        </Link>
      ),
      enableHiding: false,
    },
    {
      accessorKey: "role",
      meta: { label: "Role" },
      header: "Role",
      cell: ({ row }) => ROLE_LABELS[row.original.role],
    },
    { accessorKey: "email", meta: { label: "Email" }, header: "Email" },
    {
      accessorKey: "phone",
      meta: { label: "Phone" },
      header: "Phone",
      cell: ({ row }) => formatPhoneAU(row.original.phone) || "–",
    },
    {
      id: "licences",
      meta: { label: "Licences" },
      header: "Licences",
      cell: ({ row }) =>
        row.original.licences.length === 0 ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          <div className="space-y-1">
            {row.original.licences.map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-xs">
                <span>{LICENCE_TYPE_LABELS[l.type]}</span>
                <ExpiryBadge date={l.expiresAt} />
              </div>
            ))}
          </div>
        ),
    },
    {
      accessorKey: "openJobs",
      meta: { label: "Open jobs" },
      header: ({ column }) => <ColumnHeader column={column} title="Open jobs" />,
    },
    {
      accessorKey: "minutesThisMonth",
      meta: { label: "Hours this month" },
      header: "Hours (month)",
      cell: ({ row }) => formatMinutes(row.original.minutesThisMonth),
    },
    ...(showCosts
      ? [
          {
            accessorKey: "hourlyCostCents",
            meta: { label: "Hourly cost" },
            header: "Hourly cost",
            cell: ({ row }) => formatCents(row.original.hourlyCostCents),
          } satisfies ColumnDef<TeamRow, unknown>,
        ]
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search name, email…"
      searchText={(r) => [r.name, r.email, r.phone].join(" ")}
      filters={[{ columnId: "role", title: "Role", options: options(ROLE_LABELS) }]}
      getRowHref={(r) => `/team/${r.id}`}
      initialSort={{ id: "name", desc: false }}
      emptyMessage="No team members."
    />
  );
}
