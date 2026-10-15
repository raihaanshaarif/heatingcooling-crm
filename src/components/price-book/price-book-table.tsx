"use client";

import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { ITEM_TYPE_LABELS, SERVICE_CATEGORY_LABELS, options } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { deletePriceBookItem } from "@/server/price-book/actions";
import type { PriceBookRow } from "@/server/price-book/queries";
import { PriceBookForm } from "./price-book-form";

function RowActions({ item }: { item: PriceBookRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const remove = useAction(deletePriceBookItem, {
    successMessage: (d) =>
      d.deactivated ? "Item is in use, so it was deactivated" : "Item deleted",
    onSuccess: () => router.refresh(),
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => void remove.run({ id: item.id })}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog title="Edit price book item" open={editing} onOpenChange={setEditing}>
        {(close) => <PriceBookForm item={item} onDone={close} />}
      </FormDialog>
    </>
  );
}

export function PriceBookTable({
  data,
  canSeeCosts,
  canEdit,
}: {
  data: PriceBookRow[];
  canSeeCosts: boolean;
  canEdit: boolean;
}) {
  const columns: ColumnDef<PriceBookRow, unknown>[] = [
    {
      accessorKey: "name",
      meta: { label: "Item" },
      header: ({ column }) => <ColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <div className="max-w-80 min-w-0 whitespace-normal">
          <p className="font-medium">
            {row.original.name} {!row.original.active && <Badge variant="muted">Inactive</Badge>}
          </p>
          {row.original.sku && <p className="text-muted-foreground text-xs">{row.original.sku}</p>}
        </div>
      ),
      enableHiding: false,
    },
    {
      accessorKey: "type",
      meta: { label: "Type" },
      header: ({ column }) => <ColumnHeader column={column} title="Type" />,
      cell: ({ row }) => ITEM_TYPE_LABELS[row.original.type],
    },
    {
      accessorKey: "category",
      meta: { label: "Category" },
      header: ({ column }) => <ColumnHeader column={column} title="Category" />,
      cell: ({ row }) => SERVICE_CATEGORY_LABELS[row.original.category],
    },
    { accessorKey: "unit", meta: { label: "Unit" }, header: "Unit" },
    ...(canSeeCosts
      ? ([
          {
            accessorKey: "costCents",
            meta: { label: "Cost" },
            header: ({ column }) => <ColumnHeader column={column} title="Cost" />,
            cell: ({ row }) => (
              <span className="tabular-nums">{formatCents(row.original.costCents)}</span>
            ),
          },
        ] satisfies ColumnDef<PriceBookRow, unknown>[])
      : []),
    {
      accessorKey: "priceCents",
      meta: { label: "Price (ex GST)" },
      header: ({ column }) => <ColumnHeader column={column} title="Price ex GST" />,
      cell: ({ row }) => (
        <span className="font-medium tabular-nums">{formatCents(row.original.priceCents)}</span>
      ),
    },
    ...(canSeeCosts
      ? ([
          {
            accessorKey: "marginPercent",
            meta: { label: "Margin" },
            header: ({ column }) => <ColumnHeader column={column} title="Margin" />,
            cell: ({ row }) => {
              const m = row.original.marginPercent;
              if (m === null) return "–";
              return (
                <Badge variant={m < 20 ? "destructive" : m < 35 ? "warning" : "success"}>
                  {m}%
                </Badge>
              );
            },
          },
        ] satisfies ColumnDef<PriceBookRow, unknown>[])
      : []),
    {
      id: "status",
      accessorFn: (r) => (r.active ? "active" : "inactive"),
      meta: { label: "Status" },
      header: "Status",
      cell: ({ row }) => (row.original.active ? "Active" : "Inactive"),
    },
    ...(canEdit
      ? ([
          {
            id: "actions",
            header: "",
            cell: ({ row }) => <RowActions item={row.original} />,
            enableHiding: false,
          },
        ] satisfies ColumnDef<PriceBookRow, unknown>[])
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search items…"
      searchText={(r) => [r.name, r.sku, r.description].join(" ")}
      filters={[
        { columnId: "type", title: "Type", options: options(ITEM_TYPE_LABELS) },
        { columnId: "category", title: "Category", options: options(SERVICE_CATEGORY_LABELS) },
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
      pageSize={25}
    />
  );
}
