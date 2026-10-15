"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
import { formatDate } from "@/lib/dates";
import { deleteSupplier } from "@/server/inventory/actions";
import type { SupplierRow } from "@/server/inventory/queries";
import { SupplierForm } from "./supplier-form";

function RowActions({ supplier, canDelete }: { supplier: SupplierRow; canDelete: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const remove = useAction(deleteSupplier, {
    successMessage: (d) =>
      d.deactivated
        ? "Supplier has deliveries on record, so it was deactivated"
        : "Supplier deleted",
    onSuccess: () => router.refresh(),
  });
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Supplier actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          {canDelete && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void remove.run({ id: supplier.id })}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog title="Edit supplier" open={editing} onOpenChange={setEditing}>
        {(close) => <SupplierForm supplier={supplier} onDone={close} />}
      </FormDialog>
    </div>
  );
}

export function SuppliersTable({
  data,
  canEdit,
  canDelete,
}: {
  data: SupplierRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const columns: ColumnDef<SupplierRow, unknown>[] = [
    {
      accessorKey: "name",
      meta: { label: "Supplier" },
      header: ({ column }) => <ColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => (
        <div className="max-w-72 min-w-0 whitespace-normal">
          <p className="font-medium">
            {row.original.name} {!row.original.active && <Badge variant="muted">Inactive</Badge>}
          </p>
          {row.original.notes && (
            <p className="text-muted-foreground line-clamp-2 text-xs">{row.original.notes}</p>
          )}
        </div>
      ),
      enableHiding: false,
    },
    {
      accessorKey: "contact",
      meta: { label: "Contact" },
      header: "Contact",
      cell: ({ row }) => (
        <div className="text-sm">
          {row.original.contact && <p>{row.original.contact}</p>}
          {row.original.phone && (
            <a href={`tel:${row.original.phone}`} className="block hover:underline">
              {row.original.phone}
            </a>
          )}
          {row.original.email && (
            <a
              href={`mailto:${row.original.email}`}
              className="text-muted-foreground block text-xs hover:underline"
            >
              {row.original.email}
            </a>
          )}
        </div>
      ),
    },
    { accessorKey: "accountNumber", meta: { label: "Account no." }, header: "Account no." },
    {
      accessorKey: "itemCount",
      meta: { label: "Stocked items" },
      header: ({ column }) => <ColumnHeader column={column} title="Stocked items" />,
    },
    {
      accessorKey: "lastReceivedAt",
      meta: { label: "Last delivery" },
      sortingFn: "datetime",
      header: ({ column }) => <ColumnHeader column={column} title="Last delivery" />,
      cell: ({ row }) =>
        row.original.lastReceivedAt ? formatDate(row.original.lastReceivedAt) : "–",
    },
    {
      id: "status",
      accessorFn: (r) => (r.active ? "active" : "inactive"),
      meta: { label: "Status" },
      header: "Status",
    },
    ...(canEdit
      ? ([
          {
            id: "actions",
            header: "",
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }) => <RowActions supplier={row.original} canDelete={canDelete} />,
          },
        ] satisfies ColumnDef<SupplierRow, unknown>[])
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search suppliers…"
      searchText={(r) => [r.name, r.contact, r.email, r.phone, r.accountNumber].join(" ")}
      filters={[
        {
          columnId: "status",
          title: "Status",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ],
        },
      ]}
      initialHidden={["status"]}
      initialSort={{ id: "name", desc: false }}
      emptyMessage="No suppliers yet."
    />
  );
}
