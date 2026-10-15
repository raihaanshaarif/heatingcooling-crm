"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeftRight,
  ClipboardCheck,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import type { SelectOption } from "@/components/forms/fields";
import { formatQty, type StockStatus } from "@/lib/inventory";
import { SERVICE_CATEGORY_LABELS, STOCK_STATUS_LABELS, options } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { deleteInventoryItem } from "@/server/inventory/actions";
import type { LocationOption, StockItemOption, StockRow } from "@/server/inventory/queries";
import { InventoryItemForm } from "./inventory-item-form";
import { AdjustStockForm, ReceiveStockForm, TransferStockForm, type LevelMap } from "./stock-forms";

const STATUS_VARIANT: Record<StockStatus, BadgeVariant> = {
  OK: "success",
  LOW: "warning",
  OUT: "destructive",
  NEGATIVE: "destructive",
};

export function StockStatusBadge({ status }: { status: StockStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STOCK_STATUS_LABELS[status]}</Badge>;
}

export function Qty({ value, unit }: { value: number; unit?: string }) {
  return (
    <span className={cn("tabular-nums", value < 0 && "text-destructive font-medium")}>
      {formatQty(value, unit)}
    </span>
  );
}

interface Shared {
  items: StockItemOption[];
  locations: LocationOption[];
  suppliers: SelectOption[];
  levels: LevelMap;
  showCosts: boolean;
  canUpdateCostPrice: boolean;
  canMove: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

type Dialog = "edit" | "receive" | "transfer" | "adjust" | null;

function RowActions({
  row,
  focusLocationId,
  shared,
}: {
  row: StockRow;
  focusLocationId?: string;
  shared: Shared;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const remove = useAction(deleteInventoryItem, {
    successMessage: (d) =>
      d.deactivated ? "Item has stock history, so it's now untracked" : "Item removed",
    onSuccess: () => router.refresh(),
  });
  const close = () => setDialog(null);
  const open = (d: Dialog) => () => setDialog(d);
  const tracked = row.active;
  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Stock actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {shared.canMove && tracked && (
            <>
              <DropdownMenuItem onClick={open("receive")}>
                <PackagePlus /> Receive stock
              </DropdownMenuItem>
              <DropdownMenuItem onClick={open("transfer")}>
                <ArrowLeftRight /> Transfer
              </DropdownMenuItem>
            </>
          )}
          {shared.canEdit && tracked && (
            <DropdownMenuItem onClick={open("adjust")}>
              <ClipboardCheck /> Adjust / stocktake
            </DropdownMenuItem>
          )}
          {shared.canEdit && (
            <DropdownMenuItem onClick={open("edit")}>
              <Pencil /> Reorder level &amp; supplier
            </DropdownMenuItem>
          )}
          {shared.canDelete && tracked && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void remove.run({ id: row.id })}
              >
                <Trash2 /> Stop tracking
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog title={row.name} open={dialog === "edit"} onOpenChange={(o) => !o && close()}>
        {() => <InventoryItemForm item={row} suppliers={shared.suppliers} onDone={close} />}
      </FormDialog>
      <FormDialog
        title="Receive stock"
        open={dialog === "receive"}
        onOpenChange={(o) => !o && close()}
        wide
      >
        {() => (
          <ReceiveStockForm
            items={shared.items}
            locations={shared.locations}
            suppliers={shared.suppliers}
            showCosts={shared.showCosts}
            canUpdateCostPrice={shared.canUpdateCostPrice}
            defaultItemId={row.id}
            onDone={close}
          />
        )}
      </FormDialog>
      <FormDialog
        title="Transfer stock"
        open={dialog === "transfer"}
        onOpenChange={(o) => !o && close()}
        wide
      >
        {() => (
          <TransferStockForm
            items={shared.items}
            locations={shared.locations}
            levels={shared.levels}
            defaultItemId={row.id}
            defaultToId={focusLocationId}
            onDone={close}
          />
        )}
      </FormDialog>
      <FormDialog
        title="Adjust stock"
        description="Record a stocktake count or a correction. The reason is kept in the movement history."
        open={dialog === "adjust"}
        onOpenChange={(o) => !o && close()}
      >
        {() => (
          <AdjustStockForm
            items={shared.items}
            locations={shared.locations}
            levels={shared.levels}
            defaultItemId={row.id}
            defaultLocationId={focusLocationId}
            onDone={close}
          />
        )}
      </FormDialog>
    </div>
  );
}

/**
 * Stock by item. With no location chosen every location gets a column plus the
 * total; with one location chosen only that location's quantity is shown.
 */
export function StockTable({
  data,
  focusLocationId,
  lowOnly = false,
  ...shared
}: Shared & { data: StockRow[]; focusLocationId?: string; lowOnly?: boolean }) {
  const focus = shared.locations.find((l) => l.id === focusLocationId);
  const shownLocations = focus ? [focus] : shared.locations;
  const columns: ColumnDef<StockRow, unknown>[] = [
    {
      accessorKey: "name",
      meta: { label: "Item" },
      header: ({ column }) => <ColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <div className="max-w-72 min-w-0 whitespace-normal">
          <p className="font-medium">
            {row.original.name} {!row.original.active && <Badge variant="muted">Not tracked</Badge>}
          </p>
          <p className="text-muted-foreground text-xs">
            {[row.original.sku, row.original.unit !== "each" ? `per ${row.original.unit}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ),
      enableHiding: false,
    },
    {
      accessorKey: "category",
      meta: { label: "Category" },
      header: ({ column }) => <ColumnHeader column={column} title="Category" />,
      cell: ({ row }) => SERVICE_CATEGORY_LABELS[row.original.category],
    },
    {
      id: "supplier",
      accessorFn: (r) => r.supplierId ?? "none",
      meta: { label: "Supplier" },
      header: "Supplier",
      cell: ({ row }) => (
        <div className="text-sm">
          {row.original.supplierName ?? "–"}
          {row.original.supplierSku && (
            <span className="text-muted-foreground block text-xs">{row.original.supplierSku}</span>
          )}
        </div>
      ),
    },
    ...shownLocations.map((l): ColumnDef<StockRow, unknown> => ({
      id: `loc_${l.id}`,
      accessorFn: (r) => r.byLocation[l.id] ?? 0,
      meta: { label: l.name },
      header: ({ column }) => (
        <ColumnHeader column={column} title={l.type === "WAREHOUSE" ? "Warehouse" : l.name} />
      ),
      cell: ({ row }) => <Qty value={row.original.byLocation[l.id] ?? 0} />,
    })),
    ...(focus
      ? []
      : ([
          {
            accessorKey: "total",
            meta: { label: "Total" },
            header: ({ column }) => <ColumnHeader column={column} title="Total" />,
            cell: ({ row }) => (
              <span className="font-medium">
                <Qty value={row.original.total} unit={row.original.unit} />
              </span>
            ),
          },
        ] satisfies ColumnDef<StockRow, unknown>[])),
    {
      accessorKey: "reorderLevel",
      meta: { label: "Reorder level" },
      header: ({ column }) => <ColumnHeader column={column} title="Reorder at" />,
      cell: ({ row }) =>
        row.original.reorderLevel > 0 ? (
          <span className="tabular-nums">{formatQty(row.original.reorderLevel)}</span>
        ) : (
          "–"
        ),
    },
    ...(lowOnly
      ? ([
          {
            accessorKey: "suggestedOrder",
            meta: { label: "Suggested order" },
            header: ({ column }) => <ColumnHeader column={column} title="Suggested order" />,
            cell: ({ row }) => (
              <span className="tabular-nums">
                {formatQty(row.original.suggestedOrder, row.original.unit)}
              </span>
            ),
          },
        ] satisfies ColumnDef<StockRow, unknown>[])
      : []),
    {
      id: "status",
      accessorFn: (r) => r.status,
      meta: { label: "Status" },
      header: "Status",
      cell: ({ row }) => (
        <div className="space-y-1">
          <StockStatusBadge status={row.original.status} />
          {row.original.hasNegative && row.original.status !== "NEGATIVE" && (
            <p className="text-destructive text-xs">A location is negative</p>
          )}
        </div>
      ),
    },
    ...(shared.showCosts
      ? ([
          {
            accessorKey: "costCents",
            meta: { label: "Unit cost" },
            header: ({ column }) => <ColumnHeader column={column} title="Unit cost" />,
            cell: ({ row }) => (
              <span className="text-muted-foreground tabular-nums">
                {formatCents(row.original.costCents)}
              </span>
            ),
          },
          {
            accessorKey: "valueCents",
            meta: { label: "Value" },
            header: ({ column }) => <ColumnHeader column={column} title="Value" />,
            cell: ({ row }) => (
              <span className="tabular-nums">{formatCents(row.original.valueCents)}</span>
            ),
          },
        ] satisfies ColumnDef<StockRow, unknown>[])
      : []),
    ...(shared.canMove || shared.canEdit
      ? ([
          {
            id: "actions",
            header: "",
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }) => (
              <RowActions row={row.original} focusLocationId={focusLocationId} shared={shared} />
            ),
          },
        ] satisfies ColumnDef<StockRow, unknown>[])
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      data={data}
      urlKey={lowOnly ? "low_" : ""}
      searchPlaceholder="Search parts, SKU, supplier…"
      searchText={(r) => [r.name, r.sku, r.supplierName, r.supplierSku].join(" ")}
      filters={[
        {
          columnId: "status",
          title: "Status",
          options: (Object.keys(STOCK_STATUS_LABELS) as StockStatus[]).map((s) => ({
            value: s,
            label: STOCK_STATUS_LABELS[s],
          })),
        },
        { columnId: "category", title: "Category", options: options(SERVICE_CATEGORY_LABELS) },
        {
          columnId: "supplier",
          title: "Supplier",
          options: [{ value: "none", label: "No supplier" }, ...shared.suppliers],
        },
      ]}
      initialHidden={["category"]}
      initialSort={{ id: "name", desc: false }}
      pageSize={50}
      emptyMessage={lowOnly ? "Nothing is below its reorder level." : "No stock tracked yet."}
    />
  );
}
