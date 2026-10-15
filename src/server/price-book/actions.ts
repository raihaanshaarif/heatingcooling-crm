"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { priceBookItemSchema } from "@/lib/validations/price-book";
import { NotFoundError, idSchema, runAction } from "@/server/action";
import { audit, diff } from "@/server/audit";

function toData(d: z.output<typeof priceBookItemSchema>) {
  return {
    sku: d.sku,
    name: d.name,
    description: d.description,
    type: d.type,
    category: d.category,
    unit: d.unit,
    costCents: d.cost,
    priceCents: d.price,
    taxable: d.taxable,
    active: d.active,
  };
}

export async function savePriceBookItem(
  id: string | null,
  input: z.input<typeof priceBookItemSchema>,
) {
  return runAction(
    { schema: priceBookItemSchema, permission: [id ? "update" : "create", "priceBook"] },
    input,
    async (d, user) => {
      const data = toData(d);
      const item = await db.$transaction(async (tx) => {
        const before = id ? await tx.priceBookItem.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundError("Item");
        const saved = id
          ? await tx.priceBookItem.update({ where: { id }, data })
          : await tx.priceBookItem.create({ data });
        await audit(tx, {
          userId: user.id,
          action: id ? "UPDATE" : "CREATE",
          entityType: "PRICE_BOOK_ITEM",
          entityId: saved.id,
          changes: id ? diff(before, data) : data,
        });
        return saved;
      });
      revalidatePath("/price-book");
      return { id: item.id };
    },
  );
}

/** Items used on quotes/jobs (or with stock history) are deactivated rather than deleted so history stays intact. */
export async function deletePriceBookItem(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "priceBook"] },
    input,
    async ({ id }, user) => {
      const used =
        (await db.quoteLineItem.count({ where: { priceBookItemId: id } })) +
        (await db.jobLineItem.count({ where: { priceBookItemId: id } })) +
        (await db.stockMovement.count({ where: { item: { priceBookItemId: id } } }));
      if (used > 0) {
        await db.priceBookItem.update({ where: { id }, data: { active: false } });
        await audit(db, {
          userId: user.id,
          action: "DEACTIVATE",
          entityType: "PRICE_BOOK_ITEM",
          entityId: id,
        });
      } else {
        await db.priceBookItem.delete({ where: { id } });
        await audit(db, {
          userId: user.id,
          action: "DELETE",
          entityType: "PRICE_BOOK_ITEM",
          entityId: id,
        });
      }
      revalidatePath("/price-book");
      return { deactivated: used > 0 };
    },
  );
}
