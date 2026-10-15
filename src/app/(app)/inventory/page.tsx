import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, ClipboardCheck, Download, PackagePlus, Plus, Truck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  getLocationOptions,
  getStockItemOptions,
  getStockOverview,
  getSupplierOptions,
  getUntrackedPriceBookItems,
  listMovements,
} from "@/server/inventory/queries";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { FormDialogButton } from "@/components/shared/form-dialog-button";
import { InventoryItemForm } from "@/components/inventory/inventory-item-form";
import {
  AdjustStockForm,
  ReceiveStockForm,
  TransferStockForm,
  type LevelMap,
} from "@/components/inventory/stock-forms";
import { StockTable } from "@/components/inventory/stock-table";
import { MovementsTable } from "@/components/inventory/movements-table";

export const metadata: Metadata = { title: "Inventory" };

const VIEWS = [
  { value: "stock", label: "Stock levels" },
  { value: "low", label: "Low stock" },
  { value: "movements", label: "Movements" },
] as const;

function Chip({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm",
        active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; location?: string }>;
}) {
  const user = await requirePermission("view", "inventory");
  const { view: rawView, location } = await searchParams;
  const view = VIEWS.some((v) => v.value === rawView) ? rawView! : "stock";
  const showCosts = can(user, "view", "inventoryCosts");
  const canMove = can(user, "create", "inventory");
  const canEdit = can(user, "update", "inventory");
  const [locations, rows, items, suppliers, untracked, movements] = await Promise.all([
    getLocationOptions(),
    getStockOverview({ includeCosts: showCosts }),
    getStockItemOptions(),
    getSupplierOptions(),
    canEdit ? getUntrackedPriceBookItems() : [],
    view === "movements" ? listMovements({ includeCosts: showCosts }) : [],
  ]);
  const focus = locations.find((l) => l.id === location);
  const levels: LevelMap = Object.fromEntries(rows.map((r) => [r.id, r.byLocation]));
  const tracked = rows.filter((r) => r.active);
  const low = tracked.filter((r) => r.status !== "OK");
  const negative = tracked.filter((r) => r.hasNegative);
  const value = tracked.reduce((s, r) => s + (r.valueCents ?? 0), 0);
  const shared = {
    items,
    locations,
    suppliers,
    levels,
    showCosts,
    canUpdateCostPrice: can(user, "update", "priceBook"),
    canMove,
    canEdit,
    canDelete: can(user, "delete", "inventory"),
  };
  // Untracked items only stay visible while they still hold stock somewhere.
  const stockRows = rows.filter((r) => r.active || r.total !== 0);
  const exportHref = `/api/inventory/export${focus ? `?location=${focus.id}` : ""}`;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Parts stock in the warehouse and each technician's van. Parts added to a job are taken from the technician's van automatically."
        actions={
          <>
            {canMove && (
              <FormDialogButton
                label="Receive stock"
                title="Receive stock"
                description="A delivery from a supplier. Quantities are added to the chosen location."
                icon={<PackagePlus />}
                variant="default"
                wide
              >
                <ReceiveStockForm
                  items={items}
                  locations={locations}
                  suppliers={suppliers}
                  showCosts={showCosts}
                  canUpdateCostPrice={shared.canUpdateCostPrice}
                />
              </FormDialogButton>
            )}
            {canMove && (
              <FormDialogButton
                label="Transfer"
                title="Transfer stock"
                description="Load a van from the warehouse, or bring stock back."
                icon={<ArrowLeftRight />}
                wide
              >
                <TransferStockForm
                  items={items}
                  locations={locations}
                  levels={levels}
                  defaultToId={focus?.type === "VAN" ? focus.id : undefined}
                />
              </FormDialogButton>
            )}
            {canEdit && (
              <FormDialogButton
                label="Adjust / stocktake"
                title="Adjust stock"
                description="Record a stocktake count or a correction. The reason is kept in the movement history."
                icon={<ClipboardCheck />}
              >
                <AdjustStockForm
                  items={items}
                  locations={locations}
                  levels={levels}
                  defaultLocationId={focus?.id}
                />
              </FormDialogButton>
            )}
            {canEdit && (
              <FormDialogButton label="Track item" title="Track a part" icon={<Plus />}>
                <InventoryItemForm untracked={untracked} suppliers={suppliers} />
              </FormDialogButton>
            )}
            <Button asChild variant="outline">
              <a href={exportHref}>
                <Download /> Export CSV
              </a>
            </Button>
            {can(user, "view", "suppliers") && (
              <Button asChild variant="ghost">
                <Link href="/suppliers">
                  <Truck /> Suppliers
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className={cn("mb-4 grid gap-4", showCosts ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
        <StatCard
          label="Parts tracked"
          value={tracked.length}
          hint={`${locations.length} locations`}
        />
        <StatCard
          label="Low stock"
          value={low.length}
          hint="Below reorder level"
          tone={low.length ? "danger" : "default"}
          href="/inventory?view=low"
        />
        <StatCard
          label="Negative stock"
          value={negative.length}
          hint="Used more than recorded: recount or receive"
          tone={negative.length ? "danger" : "default"}
        />
        {showCosts && (
          <StatCard label="Stock value" value={formatCents(value)} hint="At cost price, ex GST" />
        )}
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <Chip key={v.value} href={`/inventory?view=${v.value}`} active={view === v.value}>
            {v.value === "low" ? `${v.label} (${low.length})` : v.label}
          </Chip>
        ))}
      </div>
      {view === "stock" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground mr-1 text-sm">Location:</span>
            <Chip href="/inventory" active={!focus}>
              All locations
            </Chip>
            {locations.map((l) => (
              <Chip key={l.id} href={`/inventory?location=${l.id}`} active={focus?.id === l.id}>
                {l.name}
              </Chip>
            ))}
          </div>
          <StockTable data={stockRows} focusLocationId={focus?.id} {...shared} />
        </>
      )}
      {view === "low" && <StockTable data={low} lowOnly {...shared} />}
      {view === "movements" && (
        <MovementsTable data={movements} locations={locations} showCosts={showCosts} />
      )}
    </>
  );
}
