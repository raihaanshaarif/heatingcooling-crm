"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import { PLAN_FREQUENCY_LABELS, options } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { formatDate, melbourneDaysBetween } from "@/lib/dates";
import { createJobFromPlan, deleteMaintenancePlan } from "@/server/maintenance/actions";
import type { ClientOption } from "@/server/clients/queries";
import type { PlanRow } from "@/server/maintenance/queries";
import { PlanForm } from "./plan-form";

function DueBadge({ date, active }: { date: Date; active: boolean }) {
  if (!active) return <Badge variant="muted">Inactive</Badge>;
  const days = melbourneDaysBetween(new Date(), date);
  if (days < 0) return <Badge variant="destructive">{-days}d overdue</Badge>;
  if (days <= 14) return <Badge variant="warning">Due in {days}d</Badge>;
  if (days <= 30) return <Badge variant="info">Due in {days}d</Badge>;
  return <Badge variant="muted">In {days}d</Badge>;
}

function PlanActions({
  plan,
  clients,
  canEdit,
  canBook,
}: {
  plan: PlanRow;
  clients: ClientOption[];
  canEdit: boolean;
  canBook: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const book = useAction(createJobFromPlan, {
    successMessage: "Job created",
    onSuccess: (d) => router.push(`/jobs/${d.id}`),
  });
  const remove = useAction(deleteMaintenancePlan, {
    successMessage: "Plan deleted",
    onSuccess: () => router.refresh(),
  });
  return (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {plan.openJob ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/jobs/${plan.openJob.id}`}>{plan.openJob.number}</Link>
        </Button>
      ) : (
        canBook && (
          <Button
            variant="outline"
            size="sm"
            disabled={book.pending}
            onClick={() => void book.run({ id: plan.id })}
          >
            <CalendarPlus /> Create job
          </Button>
        )
      )}
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Plan actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void remove.run({ id: plan.id })}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <FormDialog title="Edit plan" open={editing} onOpenChange={setEditing} wide>
        {(close) => <PlanForm plan={plan} clients={clients} onDone={close} />}
      </FormDialog>
    </div>
  );
}

export function PlansTable({
  data,
  clients,
  canEdit,
  canBook,
}: {
  data: PlanRow[];
  clients: ClientOption[];
  canEdit: boolean;
  canBook: boolean;
}) {
  const columns: ColumnDef<PlanRow, unknown>[] = [
    {
      accessorKey: "nextDueDate",
      meta: { label: "Next due" },
      sortingFn: "datetime",
      header: ({ column }) => <ColumnHeader column={column} title="Next due" />,
      cell: ({ row }) => (
        <div className="space-y-1">
          <p>{formatDate(row.original.nextDueDate)}</p>
          <DueBadge date={row.original.nextDueDate} active={row.original.active} />
        </div>
      ),
      enableHiding: false,
    },
    {
      accessorKey: "clientName",
      meta: { label: "Client" },
      header: ({ column }) => <ColumnHeader column={column} title="Client" />,
      cell: ({ row }) => (
        <div>
          <Link
            href={`/clients/${row.original.clientId}`}
            className="font-medium hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.clientName}
          </Link>
          {row.original.site && (
            <p className="text-muted-foreground text-xs">{row.original.site}</p>
          )}
        </div>
      ),
    },
    { accessorKey: "name", meta: { label: "Plan" }, header: "Plan" },
    {
      accessorKey: "frequency",
      meta: { label: "Frequency" },
      header: "Frequency",
      cell: ({ row }) => PLAN_FREQUENCY_LABELS[row.original.frequency],
    },
    {
      id: "units",
      meta: { label: "Units" },
      header: "Units",
      accessorFn: (r) => r.equipmentIds.length,
    },
    {
      accessorKey: "priceCents",
      meta: { label: "Price" },
      header: ({ column }) => <ColumnHeader column={column} title="Price" />,
      cell: ({ row }) => (
        <span className="tabular-nums">{formatCents(row.original.priceCents)}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => (
        <PlanActions plan={row.original} clients={clients} canEdit={canEdit} canBook={canBook} />
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search client, suburb, plan…"
      searchText={(r) => [r.clientName, r.site, r.name].join(" ")}
      filters={[
        { columnId: "frequency", title: "Frequency", options: options(PLAN_FREQUENCY_LABELS) },
      ]}
      initialSort={{ id: "nextDueDate", desc: false }}
      emptyMessage="No plans due in this window."
    />
  );
}
