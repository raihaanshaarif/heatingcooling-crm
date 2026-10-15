import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { toDateInput } from "@/lib/dates";
import { STOCK_STATUS_LABELS } from "@/lib/labels";
import { toCsv } from "@/lib/inventory";
import { getLocationOptions, getStockOverview } from "@/server/inventory/queries";
import { audit } from "@/server/audit";

export const runtime = "nodejs";

/** CSV of stock levels: /api/inventory/export (all locations) or ?location=<id>. Costs for admin only. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!can(user, "view", "inventory"))
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const includeCosts = can(user, "view", "inventoryCosts");
  const locationId = new URL(req.url).searchParams.get("location");
  const [allLocations, rows] = await Promise.all([
    getLocationOptions(),
    getStockOverview({ includeCosts }),
  ]);
  const focus = allLocations.find((l) => l.id === locationId);
  const locations = focus ? [focus] : allLocations;
  const header = [
    "SKU",
    "Item",
    "Unit",
    "Supplier",
    "Supplier part no.",
    ...locations.map((l) => l.name),
    ...(focus ? [] : ["Total"]),
    "Reorder level",
    "Status",
    ...(includeCosts ? ["Unit cost (ex GST)", "Value (ex GST)"] : []),
  ];
  const body = rows
    .filter((r) => r.active || r.total !== 0)
    .map((r) => [
      r.sku,
      r.name,
      r.unit,
      r.supplierName,
      r.supplierSku,
      ...locations.map((l) => r.byLocation[l.id] ?? 0),
      ...(focus ? [] : [r.total]),
      r.reorderLevel,
      STOCK_STATUS_LABELS[r.status],
      ...(includeCosts
        ? [((r.costCents ?? 0) / 100).toFixed(2), ((r.valueCents ?? 0) / 100).toFixed(2)]
        : []),
    ]);
  await audit(db, {
    userId: user!.id,
    action: "EXPORT",
    entityType: "INVENTORY_ITEM",
    entityId: focus?.id ?? "all",
    changes: { location: focus?.name ?? "All locations", rows: body.length },
  });
  const slug = focus
    ? focus.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+$/, "")
    : "all";
  return new NextResponse(toCsv([header, ...body]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stock_${slug}_${toDateInput(new Date())}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
