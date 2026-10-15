import "server-only";
import type { StockMovementType } from "@prisma/client";
import { db } from "@/lib/db";
import {
  STOCKABLE_TYPES,
  addQty,
  stockStatus,
  stockValueCents,
  suggestedOrderQty,
  toQty,
} from "@/lib/inventory";
import { ensureStockLocations } from "./service";

export interface LocationOption {
  id: string;
  name: string;
  type: "WAREHOUSE" | "VAN";
  userId: string | null;
  active: boolean;
}

/** Locations to show: active ones, plus inactive vans that still hold stock. */
export async function getLocationOptions(): Promise<LocationOption[]> {
  await ensureStockLocations();
  const locations = await db.stockLocation.findMany({
    where: {
      OR: [{ active: true }, { levels: { some: { quantity: { not: 0 } } } }],
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  return locations.map((l) => ({
    id: l.id,
    name: l.active ? l.name : `${l.name} (inactive)`,
    type: l.type,
    userId: l.userId,
    active: l.active,
  }));
}

/**
 * One row per tracked item with its quantity at every location, the total, status
 * against the reorder level and (only when includeCosts) its value at cost.
 */
export async function getStockOverview({ includeCosts }: { includeCosts: boolean }) {
  const items = await db.inventoryItem.findMany({
    include: {
      priceBookItem: true,
      supplier: { select: { id: true, name: true } },
      levels: true,
    },
    orderBy: { priceBookItem: { name: "asc" } },
  });
  return items.map((i) => {
    const byLocation: Record<string, number> = {};
    for (const l of i.levels) byLocation[l.locationId] = toQty(l.quantity);
    const total = addQty(...Object.values(byLocation));
    const reorderLevel = toQty(i.reorderLevel);
    const status = stockStatus(total, reorderLevel);
    return {
      id: i.id,
      priceBookItemId: i.priceBookItemId,
      sku: i.priceBookItem.sku,
      name: i.priceBookItem.name,
      type: i.priceBookItem.type,
      category: i.priceBookItem.category,
      unit: i.priceBookItem.unit,
      supplierId: i.supplier?.id ?? null,
      supplierName: i.supplier?.name ?? null,
      supplierSku: i.supplierSku,
      reorderLevel,
      active: i.active,
      byLocation,
      total,
      status,
      hasNegative: Object.values(byLocation).some((q) => q < 0),
      suggestedOrder: suggestedOrderQty(total, reorderLevel),
      // Never send costs to users who can't see them.
      costCents: includeCosts ? i.priceBookItem.costCents : null,
      valueCents: includeCosts ? stockValueCents(total, i.priceBookItem.costCents) : null,
    };
  });
}
export type StockRow = Awaited<ReturnType<typeof getStockOverview>>[number];

/** Tracked items below their reorder level (for the dashboard tile). */
export async function getLowStockSummary() {
  const rows = await getStockOverview({ includeCosts: false });
  const active = rows.filter((r) => r.active);
  return {
    low: active.filter((r) => r.status !== "OK").length,
    negative: active.filter((r) => r.hasNegative).length,
  };
}

export interface MovementFilters {
  locationId?: string;
  itemId?: string;
  type?: StockMovementType;
  jobId?: string;
  take?: number;
}

export async function listMovements(
  { includeCosts }: { includeCosts: boolean },
  filters: MovementFilters = {},
) {
  const movements = await db.stockMovement.findMany({
    where: {
      ...(filters.itemId ? { inventoryItemId: filters.itemId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.jobId ? { jobId: filters.jobId } : {}),
      ...(filters.locationId
        ? { OR: [{ fromLocationId: filters.locationId }, { toLocationId: filters.locationId }] }
        : {}),
    },
    include: {
      item: { include: { priceBookItem: { select: { name: true, sku: true, unit: true } } } },
      fromLocation: { select: { id: true, name: true } },
      toLocation: { select: { id: true, name: true } },
      job: { select: { id: true, number: true } },
      receipt: { select: { reference: true, supplier: { select: { name: true } } } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: filters.take ?? 500,
  });
  return movements.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    type: m.type,
    itemId: m.inventoryItemId,
    itemName: m.item.priceBookItem.name,
    sku: m.item.priceBookItem.sku,
    unit: m.item.priceBookItem.unit,
    quantity: toQty(m.quantity),
    from: m.fromLocation,
    to: m.toLocation,
    locationIds: [m.fromLocation?.id, m.toLocation?.id].filter((x): x is string => !!x),
    job: m.job,
    supplierName: m.receipt?.supplier?.name ?? null,
    reference: m.receipt?.reference ?? null,
    reason: m.reason,
    userName: m.user?.name ?? null,
    unitCostCents: includeCosts ? m.unitCostCents : null,
  }));
}
export type MovementRow = Awaited<ReturnType<typeof listMovements>>[number];

/** A technician's own van, read-only, for My jobs. */
export async function getVanStock(userId: string) {
  await ensureStockLocations();
  const van = await db.stockLocation.findUnique({
    where: { userId },
    include: {
      levels: {
        where: { item: { active: true } },
        include: {
          item: { include: { priceBookItem: { select: { name: true, sku: true, unit: true } } } },
        },
      },
    },
  });
  if (!van) return null;
  const items = van.levels
    .map((l) => ({
      id: l.id,
      name: l.item.priceBookItem.name,
      sku: l.item.priceBookItem.sku,
      unit: l.item.priceBookItem.unit,
      quantity: toQty(l.quantity),
    }))
    .filter((i) => i.quantity !== 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const recent = await db.stockMovement.findMany({
    where: { OR: [{ fromLocationId: van.id }, { toLocationId: van.id }] },
    include: {
      item: { include: { priceBookItem: { select: { name: true, unit: true } } } },
      job: { select: { id: true, number: true } },
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  return {
    id: van.id,
    name: van.name,
    items,
    recent: recent.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      type: m.type,
      itemName: m.item.priceBookItem.name,
      unit: m.item.priceBookItem.unit,
      // Signed from the van's point of view.
      quantity: (m.toLocationId === van.id ? 1 : -1) * toQty(m.quantity),
      job: m.job,
      other: m.toLocationId === van.id ? m.fromLocation?.name : m.toLocation?.name,
    })),
  };
}

/** Price book parts / equipment not yet tracked, for "Track an item". */
export async function getUntrackedPriceBookItems() {
  const items = await db.priceBookItem.findMany({
    where: { active: true, type: { in: [...STOCKABLE_TYPES] }, inventoryItems: { none: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, sku: true, unit: true },
  });
  return items.map((i) => ({
    value: i.id,
    label: i.sku ? `${i.name} (${i.sku})` : i.name,
  }));
}

/** Items for the receive / transfer / adjust forms. */
export async function getStockItemOptions() {
  const items = await db.inventoryItem.findMany({
    where: { active: true },
    include: { priceBookItem: { select: { name: true, sku: true, unit: true, costCents: true } } },
    orderBy: { priceBookItem: { name: "asc" } },
  });
  return items.map((i) => ({
    value: i.id,
    label: i.priceBookItem.name,
    sku: i.priceBookItem.sku,
    unit: i.priceBookItem.unit,
    supplierId: i.supplierId,
    costCents: i.priceBookItem.costCents,
  }));
}
export type StockItemOption = Awaited<ReturnType<typeof getStockItemOptions>>[number];

export async function listSuppliers() {
  const suppliers = await db.supplier.findMany({
    include: {
      _count: { select: { inventoryItems: true, receipts: true } },
      receipts: { select: { receivedAt: true }, orderBy: { receivedAt: "desc" }, take: 1 },
    },
    orderBy: { name: "asc" },
  });
  return suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    contact: s.contact,
    phone: s.phone,
    email: s.email,
    accountNumber: s.accountNumber,
    website: s.website,
    notes: s.notes,
    active: s.active,
    itemCount: s._count.inventoryItems,
    receiptCount: s._count.receipts,
    lastReceivedAt: s.receipts[0]?.receivedAt ?? null,
  }));
}
export type SupplierRow = Awaited<ReturnType<typeof listSuppliers>>[number];

export async function getSupplierOptions() {
  const suppliers = await db.supplier.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return suppliers.map((s) => ({ value: s.id, label: s.name }));
}
