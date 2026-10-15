import "server-only";
import { Prisma, type StockMovementType } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import {
  addQty,
  chooseUsageLocation,
  crossedBelowReorder,
  formatQty,
  isStockable,
  movementDeltas,
  netDelta,
  returnsForLine,
  toQty,
  validateMovement,
} from "@/lib/inventory";
import { UserError } from "@/server/action";
import { audit, notifyRoles } from "@/server/audit";

type Client = Tx | typeof db;

export const vanName = (userName: string) => `${userName}'s van`;

/**
 * Make sure the warehouse exists and every active technician has a van. Vans of
 * technicians who leave (or change role) are deactivated, never deleted, so their
 * history stays. Safe to call often: it only writes when something is missing.
 */
export async function ensureStockLocations(client: Client = db) {
  try {
    const warehouse = await client.stockLocation.findFirst({
      where: { type: "WAREHOUSE" },
      orderBy: { createdAt: "asc" },
    });
    if (!warehouse)
      await client.stockLocation.create({ data: { name: "Warehouse", type: "WAREHOUSE" } });
    const techs = await client.user.findMany({
      where: { OR: [{ role: "TECHNICIAN" }, { van: { isNot: null } }] },
      select: { id: true, name: true, role: true, active: true, van: true },
    });
    for (const t of techs) {
      const shouldHaveVan = t.role === "TECHNICIAN" && t.active;
      if (!t.van) {
        if (shouldHaveVan)
          await client.stockLocation.create({
            data: { name: vanName(t.name), type: "VAN", userId: t.id },
          });
      } else if (t.van.active !== shouldHaveVan || t.van.name !== vanName(t.name)) {
        await client.stockLocation.update({
          where: { id: t.van.id },
          data: { active: shouldHaveVan, name: vanName(t.name) },
        });
      }
    }
  } catch (error) {
    // Two requests creating the same van at once: the unique userId wins, nothing to do.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"))
      throw error;
  }
}

/** The warehouse and active vans. */
export async function getStockLocations(client: Client = db) {
  const locations = await client.stockLocation.findMany({
    where: { active: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  const warehouse = locations.find((l) => l.type === "WAREHOUSE");
  if (!warehouse) throw new UserError("No warehouse set up yet. Open Inventory once to create it.");
  return { warehouse, vans: locations.filter((l) => l.type === "VAN"), all: locations };
}

export interface MovementInput {
  inventoryItemId: string;
  type: StockMovementType;
  quantity: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  unitCostCents?: number | null;
  reason?: string | null;
  jobId?: string | null;
  jobLineItemId?: string | null;
  receiptId?: string | null;
  userId: string | null;
}

/**
 * The only way stock changes: write one ledger row and update the affected levels
 * in the same transaction, audit it, and tell the office when the item's total first
 * drops below its reorder level. Negative levels are allowed and reported back.
 */
export async function recordMovement(tx: Tx, input: MovementInput) {
  const m = {
    inventoryItemId: input.inventoryItemId,
    type: input.type,
    quantity: toQty(input.quantity),
    fromLocationId: input.fromLocationId ?? null,
    toLocationId: input.toLocationId ?? null,
  };
  const invalid = validateMovement(m);
  if (invalid) throw new UserError(invalid);
  const item = await tx.inventoryItem.findUnique({
    where: { id: m.inventoryItemId },
    include: { priceBookItem: { select: { name: true, unit: true } } },
  });
  if (!item) throw new UserError("That item isn't tracked in inventory.");
  const before = await tx.stockLevel.aggregate({
    where: { inventoryItemId: item.id },
    _sum: { quantity: true },
  });
  const totalBefore = toQty(before._sum.quantity);

  const movement = await tx.stockMovement.create({
    data: {
      ...m,
      unitCostCents: input.unitCostCents ?? null,
      reason: input.reason ?? null,
      jobId: input.jobId ?? null,
      jobLineItemId: input.jobLineItemId ?? null,
      receiptId: input.receiptId ?? null,
      userId: input.userId,
    },
  });
  const levels: { locationId: string; locationName: string; quantity: number }[] = [];
  for (const d of movementDeltas(m)) {
    const level = await tx.stockLevel.upsert({
      where: {
        inventoryItemId_locationId: { inventoryItemId: item.id, locationId: d.locationId },
      },
      create: { inventoryItemId: item.id, locationId: d.locationId, quantity: d.delta },
      update: { quantity: { increment: d.delta } },
      include: { location: { select: { name: true } } },
    });
    levels.push({
      locationId: d.locationId,
      locationName: level.location.name,
      quantity: toQty(level.quantity),
    });
  }
  const totalAfter = addQty(totalBefore, netDelta(m));
  const reorderLevel = toQty(item.reorderLevel);

  await audit(tx, {
    userId: input.userId,
    action: `STOCK_${m.type}`,
    entityType: "INVENTORY_ITEM",
    entityId: item.id,
    changes: {
      item: item.priceBookItem.name,
      quantity: m.quantity,
      from: levels.find((l) => l.locationId === m.fromLocationId)?.locationName ?? null,
      to: levels.find((l) => l.locationId === m.toLocationId)?.locationName ?? null,
      reason: input.reason ?? undefined,
      jobId: input.jobId ?? undefined,
      totalBefore,
      totalAfter,
    },
  });

  if (item.active && crossedBelowReorder(totalBefore, totalAfter, reorderLevel)) {
    await notifyRoles(tx, ["ADMIN", "OFFICE"], {
      title: `Low stock: ${item.priceBookItem.name}`,
      body: `${formatQty(totalAfter, item.priceBookItem.unit)} left across all locations (reorder level ${formatQty(reorderLevel, item.priceBookItem.unit)}).`,
      link: "/inventory?view=low",
    });
  }

  return {
    movement,
    item,
    unit: item.priceBookItem.unit,
    levels,
    totalBefore,
    totalAfter,
    negative: levels.filter((l) => l.quantity < 0),
  };
}

export interface StockNote {
  locationName: string;
  quantityLeft: number;
  unit: string;
  negative: boolean;
  isVan: boolean;
}

/**
 * Parts from the price book used on a job come out of the assigned technician's van
 * (the one adding them if they're on the job), else the warehouse. Lines that aren't
 * tracked stock (labour, custom lines, untracked parts) are ignored.
 */
export async function deductForJobLine(
  tx: Tx,
  input: {
    jobId: string;
    line: { id: string; priceBookItemId: string | null; quantity: number; unitCostCents: number };
    actingUserId: string;
  },
): Promise<StockNote | null> {
  if (!input.line.priceBookItemId) return null;
  const item = await tx.inventoryItem.findUnique({
    where: { priceBookItemId: input.line.priceBookItemId },
    include: { priceBookItem: { select: { type: true } } },
  });
  if (!item || !item.active || !isStockable(item.priceBookItem.type)) return null;
  await ensureStockLocations(tx);
  const { warehouse, vans } = await getStockLocations(tx);
  const assignments = await tx.jobAssignment.findMany({
    where: { jobId: input.jobId },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  const fromLocationId = chooseUsageLocation({
    actingUserId: input.actingUserId,
    assignedUserIds: assignments.map((a) => a.userId),
    vans,
    warehouseId: warehouse.id,
  });
  const result = await recordMovement(tx, {
    inventoryItemId: item.id,
    type: "JOB_USE",
    quantity: input.line.quantity,
    fromLocationId,
    unitCostCents: input.line.unitCostCents,
    jobId: input.jobId,
    jobLineItemId: input.line.id,
    userId: input.actingUserId,
  });
  const level = result.levels[0];
  return {
    locationName: level.locationName,
    quantityLeft: level.quantity,
    unit: result.unit,
    negative: level.quantity < 0,
    isVan: fromLocationId !== warehouse.id,
  };
}

/** Put back whatever a job line took from stock, to the location it came from. */
export async function returnForJobLine(
  tx: Tx,
  input: { jobId: string; lineId: string; actingUserId: string },
) {
  const movements = await tx.stockMovement.findMany({
    where: { jobLineItemId: input.lineId },
    orderBy: { createdAt: "asc" },
  });
  const returns = returnsForLine(movements.map((m) => ({ ...m, quantity: toQty(m.quantity) })));
  const notes: { locationName: string; quantity: number }[] = [];
  for (const r of returns) {
    const result = await recordMovement(tx, {
      inventoryItemId: r.inventoryItemId,
      type: "JOB_RETURN",
      quantity: r.quantity,
      toLocationId: r.locationId,
      reason: "Removed from job",
      jobId: input.jobId,
      jobLineItemId: input.lineId,
      userId: input.actingUserId,
    });
    notes.push({ locationName: result.levels[0].locationName, quantity: r.quantity });
  }
  return notes;
}

/** Plain-English summary for a toast after adding a part to a job. */
export function describeStockNote(note: StockNote | null, forTechnician: boolean): string | null {
  if (!note) return null;
  const where = forTechnician && note.isVan ? "your van" : note.locationName;
  const left = formatQty(note.quantityLeft, note.unit);
  if (!note.negative) return `Taken from ${where} (${left} left).`;
  return forTechnician
    ? `Taken from ${where}, which now shows ${left}. Let the office know so they can restock or correct it.`
    : `Taken from ${where}, which now shows ${left}. Restock it or correct the count in Inventory.`;
}
