"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { db } from "@/lib/db";
import { can, ForbiddenError } from "@/lib/permissions";
import { adjustmentFor, formatQty, isStockable, toQty } from "@/lib/inventory";
import {
  adjustStockSchema,
  inventoryItemSchema,
  receiveStockSchema,
  supplierSchema,
  transferStockSchema,
} from "@/lib/validations/inventory";
import { NotFoundError, UserError, idSchema, runAction } from "@/server/action";
import { audit, diff, logActivity } from "@/server/audit";
import { loadJobFor } from "@/server/jobs/service";
import {
  describeStockNote,
  deductForJobLine,
  ensureStockLocations,
  recordMovement,
} from "./service";

function revalidateInventory() {
  revalidatePath("/inventory");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/my-jobs/van");
}

async function activeLocation(id: string) {
  const location = await db.stockLocation.findUnique({ where: { id } });
  if (!location) throw new NotFoundError("Location");
  if (!location.active) throw new UserError(`${location.name} is no longer in use.`);
  return location;
}

// ─── Tracked items ──────────────────────────────────────────────────────────

export async function saveInventoryItem(
  id: string | null,
  input: z.input<typeof inventoryItemSchema>,
) {
  return runAction(
    { schema: inventoryItemSchema, permission: [id ? "update" : "create", "inventory"] },
    input,
    async (d, user) => {
      const pbItem = await db.priceBookItem.findUnique({ where: { id: d.priceBookItemId } });
      if (!pbItem) throw new NotFoundError("Price book item");
      if (!isStockable(pbItem.type))
        throw new UserError("Only parts and equipment can be stocked, not labour or fees.");
      const data = {
        reorderLevel: d.reorderLevel,
        supplierId: d.supplierId,
        supplierSku: d.supplierSku,
        active: d.active,
      };
      const saved = await db.$transaction(async (tx) => {
        const before = id ? await tx.inventoryItem.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundError("Item");
        const item = id
          ? await tx.inventoryItem.update({ where: { id }, data })
          : await tx.inventoryItem.create({ data: { ...data, priceBookItemId: pbItem.id } });
        await audit(tx, {
          userId: user.id,
          action: id ? "UPDATE" : "CREATE",
          entityType: "INVENTORY_ITEM",
          entityId: item.id,
          changes: id
            ? diff(before ? { ...before, reorderLevel: toQty(before.reorderLevel) } : null, data)
            : { item: pbItem.name, ...data },
        });
        return item;
      });
      await ensureStockLocations();
      revalidateInventory();
      return { id: saved.id };
    },
  );
}

/** Stop tracking an item. Items with history are hidden (inactive) rather than deleted. */
export async function deleteInventoryItem(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "inventory"] },
    input,
    async ({ id }, user) => {
      const item = await db.inventoryItem.findUnique({
        where: { id },
        include: { _count: { select: { movements: true } }, priceBookItem: true },
      });
      if (!item) throw new NotFoundError("Item");
      const keep = item._count.movements > 0;
      await db.$transaction(async (tx) => {
        if (keep) await tx.inventoryItem.update({ where: { id }, data: { active: false } });
        else await tx.inventoryItem.delete({ where: { id } });
        await audit(tx, {
          userId: user.id,
          action: keep ? "DEACTIVATE" : "DELETE",
          entityType: "INVENTORY_ITEM",
          entityId: id,
          changes: { item: item.priceBookItem.name },
        });
      });
      revalidateInventory();
      return { deactivated: keep };
    },
  );
}

// ─── Stock movements ────────────────────────────────────────────────────────

/** A delivery from a supplier: one receipt, one RECEIVE movement per line. */
export async function receiveStock(input: z.input<typeof receiveStockSchema>) {
  return runAction(
    { schema: receiveStockSchema, permission: ["create", "inventory"] },
    input,
    async (d, user) => {
      const canCosts = can(user, "view", "inventoryCosts");
      if (d.updateCostPrice && !can(user, "update", "priceBook")) throw new ForbiddenError();
      await activeLocation(d.locationId);
      const receipt = await db.$transaction(async (tx) => {
        const items = await tx.inventoryItem.findMany({
          where: { id: { in: d.lines.map((l) => l.inventoryItemId) } },
          include: { priceBookItem: true },
        });
        const lines = d.lines.map((l) => {
          const item = items.find((i) => i.id === l.inventoryItemId);
          if (!item) throw new NotFoundError("Item");
          // Office can't see costs: they're taken from the price book.
          const unitCostCents =
            canCosts && l.unitCost !== null ? l.unitCost : item.priceBookItem.costCents;
          return { ...l, item, unitCostCents };
        });
        const total = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitCostCents), 0);
        const created = await tx.stockReceipt.create({
          data: {
            supplierId: d.supplierId,
            locationId: d.locationId,
            reference: d.reference,
            notes: d.notes,
            totalCostCents: total,
            userId: user.id,
          },
        });
        for (const l of lines) {
          await recordMovement(tx, {
            inventoryItemId: l.inventoryItemId,
            type: "RECEIVE",
            quantity: l.quantity,
            toLocationId: d.locationId,
            unitCostCents: l.unitCostCents,
            reason: d.reference ? `Ref ${d.reference}` : null,
            receiptId: created.id,
            userId: user.id,
          });
          if (
            d.updateCostPrice &&
            canCosts &&
            l.unitCost !== null &&
            l.unitCost !== l.item.priceBookItem.costCents
          ) {
            await tx.priceBookItem.update({
              where: { id: l.item.priceBookItemId },
              data: { costCents: l.unitCost },
            });
            await audit(tx, {
              userId: user.id,
              action: "UPDATE",
              entityType: "PRICE_BOOK_ITEM",
              entityId: l.item.priceBookItemId,
              changes: {
                costCents: { from: l.item.priceBookItem.costCents, to: l.unitCost },
                source: "Stock received",
              },
            });
          }
          if (d.supplierId && !l.item.supplierId)
            await tx.inventoryItem.update({
              where: { id: l.item.id },
              data: { supplierId: d.supplierId },
            });
        }
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "STOCK_RECEIPT",
          entityId: created.id,
          changes: {
            supplierId: d.supplierId,
            reference: d.reference,
            lines: lines.map((l) => ({ item: l.item.priceBookItem.name, quantity: l.quantity })),
            ...(canCosts ? { totalCostCents: total } : {}),
          },
        });
        return created;
      });
      revalidateInventory();
      if (d.updateCostPrice) revalidatePath("/price-book");
      return { id: receipt.id, lines: d.lines.length };
    },
  );
}

/** Move stock between the warehouse and a van (or van to van). */
export async function transferStock(input: z.input<typeof transferStockSchema>) {
  return runAction(
    { schema: transferStockSchema, permission: ["create", "inventory"] },
    input,
    async (d, user) => {
      // Stock can still be moved out of an inactive van (e.g. a technician who left).
      if (!(await db.stockLocation.findUnique({ where: { id: d.fromLocationId } })))
        throw new NotFoundError("Location");
      await activeLocation(d.toLocationId);
      const negative: string[] = [];
      await db.$transaction(async (tx) => {
        for (const l of d.lines) {
          const r = await recordMovement(tx, {
            inventoryItemId: l.inventoryItemId,
            type: "TRANSFER",
            quantity: l.quantity,
            fromLocationId: d.fromLocationId,
            toLocationId: d.toLocationId,
            reason: d.note,
            userId: user.id,
          });
          for (const n of r.negative)
            negative.push(
              `${r.item.priceBookItem.name} at ${n.locationName}: ${formatQty(n.quantity, r.unit)}`,
            );
        }
      });
      revalidateInventory();
      return { lines: d.lines.length, negative };
    },
  );
}

/** Stocktake count or correction at one location, always with a reason. */
export async function adjustStock(input: z.input<typeof adjustStockSchema>) {
  return runAction(
    { schema: adjustStockSchema, permission: ["update", "inventory"] },
    input,
    async (d, user) => {
      await activeLocation(d.locationId);
      const result = await db.$transaction(async (tx) => {
        const level = await tx.stockLevel.findUnique({
          where: {
            inventoryItemId_locationId: {
              inventoryItemId: d.inventoryItemId,
              locationId: d.locationId,
            },
          },
        });
        const current = toQty(level?.quantity);
        const adjustment = adjustmentFor({
          inventoryItemId: d.inventoryItemId,
          locationId: d.locationId,
          current,
          mode: d.mode,
          quantity: d.quantity,
        });
        if (!adjustment) return { changed: false, quantity: current };
        const r = await recordMovement(tx, {
          ...adjustment,
          reason: d.note ? `${d.reason}: ${d.note}` : d.reason,
          userId: user.id,
        });
        return { changed: true, quantity: r.levels[0].quantity };
      });
      revalidateInventory();
      return result;
    },
  );
}

/**
 * Take an existing job line out of stock (e.g. brackets and isolators copied from an
 * accepted quote). Lines added under "Parts & labour used" are deducted automatically.
 */
export async function deductJobLineStock(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["create", "inventory"] },
    input,
    async ({ id }, user) => {
      const line = await db.jobLineItem.findUnique({
        where: { id },
        include: { _count: { select: { stockMovements: true } } },
      });
      if (!line) throw new NotFoundError("Line");
      if (line._count.stockMovements > 0)
        throw new UserError("This line has already been taken from stock.");
      const note = await db.$transaction(async (tx) => {
        await loadJobFor(user, line.jobId, tx);
        const n = await deductForJobLine(tx, {
          jobId: line.jobId,
          line: { ...line, quantity: toQty(line.quantity) },
          actingUserId: user.id,
        });
        if (!n) throw new UserError("That item isn't tracked in inventory.");
        await logActivity(tx, {
          entityType: "JOB",
          entityId: line.jobId,
          body: `Taken from stock (${n.locationName}): ${toQty(line.quantity)} × ${line.description}`,
          userId: user.id,
        });
        return n;
      });
      revalidateInventory();
      revalidatePath(`/jobs/${line.jobId}`);
      revalidatePath(`/my-jobs/${line.jobId}`);
      return { message: describeStockNote(note, false), negative: note.negative };
    },
  );
}

// ─── Suppliers ──────────────────────────────────────────────────────────────

export async function saveSupplier(id: string | null, input: z.input<typeof supplierSchema>) {
  return runAction(
    { schema: supplierSchema, permission: [id ? "update" : "create", "suppliers"] },
    input,
    async (d, user) => {
      const saved = await db.$transaction(async (tx) => {
        const before = id ? await tx.supplier.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundError("Supplier");
        const supplier = id
          ? await tx.supplier.update({ where: { id }, data: d })
          : await tx.supplier.create({ data: d });
        await audit(tx, {
          userId: user.id,
          action: id ? "UPDATE" : "CREATE",
          entityType: "SUPPLIER",
          entityId: supplier.id,
          changes: id ? diff(before, d) : d,
        });
        return supplier;
      });
      revalidateInventory();
      return { id: saved.id };
    },
  );
}

/** Suppliers with deliveries on record are deactivated so the history keeps their name. */
export async function deleteSupplier(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "suppliers"] },
    input,
    async ({ id }, user) => {
      const supplier = await db.supplier.findUnique({
        where: { id },
        include: { _count: { select: { receipts: true } } },
      });
      if (!supplier) throw new NotFoundError("Supplier");
      const keep = supplier._count.receipts > 0;
      await db.$transaction(async (tx) => {
        if (keep) await tx.supplier.update({ where: { id }, data: { active: false } });
        else await tx.supplier.delete({ where: { id } });
        await audit(tx, {
          userId: user.id,
          action: keep ? "DEACTIVATE" : "DELETE",
          entityType: "SUPPLIER",
          entityId: id,
          changes: { name: supplier.name },
        });
      });
      revalidateInventory();
      return { deactivated: keep };
    },
  );
}
