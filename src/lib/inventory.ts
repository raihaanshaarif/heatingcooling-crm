import type { ItemType, StockMovementType } from "@prisma/client";

/**
 * Pure stock logic (no database): quantity maths, how a movement changes each
 * location, low-stock rules and where a job's parts come from. The server layer
 * (src/server/inventory/service.ts) writes the movements and levels in one
 * transaction using these functions; they are unit tested in inventory.test.ts.
 */

/** Quantities have two decimals (refrigerant in kg, pipe in metres). Work in hundredths to avoid float drift. */
export function roundQty(n: number): number {
  return Math.round(n * 100) / 100;
}

export function addQty(...values: number[]): number {
  return values.reduce((s, v) => s + Math.round(v * 100), 0) / 100;
}

/** Prisma Decimal / string / number → number rounded to 2 dp (0 when missing). */
export function toQty(value: { toString(): string } | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? roundQty(n) : 0;
}

/** Display a quantity without trailing zeros: 3, 2.5, 0.25. */
export function formatQty(n: number, unit?: string | null): string {
  const text = roundQty(n).toLocaleString("en-AU", { maximumFractionDigits: 2 });
  if (!unit || unit === "each") return text;
  return `${text} ${unit}`;
}

/** Only physical things are stocked: parts and equipment, never labour or call-out fees. */
export const STOCKABLE_TYPES: readonly ItemType[] = ["PART", "EQUIPMENT"];
export function isStockable(type: ItemType): boolean {
  return STOCKABLE_TYPES.includes(type);
}

export interface MovementLike {
  inventoryItemId: string;
  type: StockMovementType;
  /** Always positive. */
  quantity: number;
  fromLocationId: string | null;
  toLocationId: string | null;
}

/** What each movement type must look like (which side(s) of the move are set). */
export function validateMovement(m: MovementLike): string | null {
  if (!(m.quantity > 0)) return "Quantity must be more than 0";
  switch (m.type) {
    case "RECEIVE":
    case "JOB_RETURN":
      if (!m.toLocationId || m.fromLocationId) return `${m.type} needs a destination only`;
      return null;
    case "JOB_USE":
      if (!m.fromLocationId || m.toLocationId) return "JOB_USE needs a source only";
      return null;
    case "TRANSFER":
      if (!m.fromLocationId || !m.toLocationId) return "A transfer needs both locations";
      if (m.fromLocationId === m.toLocationId) return "Choose two different locations";
      return null;
    case "ADJUST":
      if (!!m.fromLocationId === !!m.toLocationId) return "An adjustment changes one location";
      return null;
  }
}

/** The quantity change a movement makes at each location (from loses, to gains). */
export function movementDeltas(m: MovementLike): { locationId: string; delta: number }[] {
  const out: { locationId: string; delta: number }[] = [];
  if (m.fromLocationId) out.push({ locationId: m.fromLocationId, delta: -roundQty(m.quantity) });
  if (m.toLocationId) out.push({ locationId: m.toLocationId, delta: roundQty(m.quantity) });
  return out;
}

/** Net change to the business's total stock (transfers net to zero). */
export function netDelta(m: MovementLike): number {
  return addQty(...movementDeltas(m).map((d) => d.delta));
}

export const levelKey = (inventoryItemId: string, locationId: string) =>
  `${inventoryItemId}:${locationId}`;

/** Rebuild stock levels from the ledger. Used to check stored levels and in tests. */
export function levelsFromMovements(movements: MovementLike[]): Map<string, number> {
  const levels = new Map<string, number>();
  for (const m of movements) {
    for (const d of movementDeltas(m)) {
      const key = levelKey(m.inventoryItemId, d.locationId);
      levels.set(key, addQty(levels.get(key) ?? 0, d.delta));
    }
  }
  return levels;
}

export type StockStatus = "NEGATIVE" | "OUT" | "LOW" | "OK";

/** Status of an item's total stock against its reorder level (0 = no reorder level). */
export function stockStatus(total: number, reorderLevel: number): StockStatus {
  if (total < 0) return "NEGATIVE";
  if (total === 0 && reorderLevel > 0) return "OUT";
  if (reorderLevel > 0 && total < reorderLevel) return "LOW";
  return "OK";
}

export function isLowStock(total: number, reorderLevel: number): boolean {
  return stockStatus(total, reorderLevel) !== "OK";
}

/** True only when this movement takes the total from at/above the reorder level to below it. */
export function crossedBelowReorder(before: number, after: number, reorderLevel: number): boolean {
  return reorderLevel > 0 && before >= reorderLevel && after < reorderLevel;
}

/** How many to order to get back to twice the reorder level (a simple min/max rule). */
export function suggestedOrderQty(total: number, reorderLevel: number): number {
  if (reorderLevel <= 0) return 0;
  return Math.max(0, roundQty(reorderLevel * 2 - total));
}

export interface VanRef {
  id: string;
  userId: string | null;
}

/**
 * Where parts used on a job come from: the van of the technician adding them if they
 * are on the job, else the first assigned technician that has a van, else the warehouse.
 */
export function chooseUsageLocation(input: {
  actingUserId: string;
  assignedUserIds: string[];
  vans: VanRef[];
  warehouseId: string;
}): string {
  const vanFor = (userId: string) => input.vans.find((v) => v.userId === userId)?.id;
  if (input.assignedUserIds.includes(input.actingUserId)) {
    const own = vanFor(input.actingUserId);
    if (own) return own;
  }
  for (const userId of input.assignedUserIds) {
    const van = vanFor(userId);
    if (van) return van;
  }
  return input.warehouseId;
}

/**
 * Movements needed to put a removed job line's stock back. Takes everything already
 * recorded for the line (uses and earlier returns) and returns what is still out, per location.
 */
export function returnsForLine(
  movements: MovementLike[],
): { inventoryItemId: string; locationId: string; quantity: number }[] {
  const outstanding = new Map<string, { inventoryItemId: string; locationId: string; q: number }>();
  for (const m of movements) {
    if (m.type === "JOB_USE" && m.fromLocationId) {
      const key = levelKey(m.inventoryItemId, m.fromLocationId);
      const cur = outstanding.get(key) ?? {
        inventoryItemId: m.inventoryItemId,
        locationId: m.fromLocationId,
        q: 0,
      };
      cur.q = addQty(cur.q, m.quantity);
      outstanding.set(key, cur);
    } else if (m.type === "JOB_RETURN" && m.toLocationId) {
      const key = levelKey(m.inventoryItemId, m.toLocationId);
      const cur = outstanding.get(key);
      if (cur) cur.q = addQty(cur.q, -m.quantity);
    }
  }
  return [...outstanding.values()]
    .filter((o) => o.q > 0)
    .map((o) => ({ inventoryItemId: o.inventoryItemId, locationId: o.locationId, quantity: o.q }));
}

/**
 * A stocktake / correction as a single ADJUST movement. "set" records the counted
 * quantity; "add" / "remove" change it by the amount. Returns null when nothing changes.
 */
export function adjustmentFor(input: {
  inventoryItemId: string;
  locationId: string;
  current: number;
  mode: "set" | "add" | "remove";
  quantity: number;
}): MovementLike | null {
  const delta =
    input.mode === "set"
      ? addQty(input.quantity, -input.current)
      : input.mode === "add"
        ? roundQty(input.quantity)
        : -roundQty(input.quantity);
  if (delta === 0) return null;
  return {
    inventoryItemId: input.inventoryItemId,
    type: "ADJUST",
    quantity: Math.abs(delta),
    fromLocationId: delta < 0 ? input.locationId : null,
    toLocationId: delta > 0 ? input.locationId : null,
  };
}

/** Value of stock at cost; negative quantities count as zero. */
export function stockValueCents(quantity: number, unitCostCents: number): number {
  return Math.round(Math.max(0, quantity) * unitCostCents);
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV rows → text (CRLF, quoted where needed), same style as the report exports. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
