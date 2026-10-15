import "server-only";
import { db } from "@/lib/db";
import { marginPercent } from "@/lib/money";

export async function listPriceBook({ includeCosts }: { includeCosts: boolean }) {
  const items = await db.priceBookItem.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
  return items.map((i) => ({
    id: i.id,
    sku: i.sku,
    name: i.name,
    description: i.description,
    type: i.type,
    category: i.category,
    unit: i.unit,
    priceCents: i.priceCents,
    taxable: i.taxable,
    active: i.active,
    // Never send costs/margins to users who can't see them.
    costCents: includeCosts ? i.costCents : null,
    marginPercent: includeCosts ? marginPercent(i.costCents, i.priceCents) : null,
  }));
}
export type PriceBookRow = Awaited<ReturnType<typeof listPriceBook>>[number];

/** Active items for line-item pickers. Cost is included only when the caller may see it. */
export async function getPriceBookPicker({ includeCosts }: { includeCosts: boolean }) {
  const items = await db.priceBookItem.findMany({
    where: { active: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  return items.map((i) => ({
    id: i.id,
    sku: i.sku,
    name: i.name,
    description: i.description,
    type: i.type,
    category: i.category,
    unit: i.unit,
    priceCents: i.priceCents,
    costCents: includeCosts ? i.costCents : 0,
    taxable: i.taxable,
  }));
}
export type PriceBookPickerItem = Awaited<ReturnType<typeof getPriceBookPicker>>[number];
