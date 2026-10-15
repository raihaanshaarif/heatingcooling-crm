import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { parseDateRange, toDateInput } from "@/lib/dates";
import { invoicesToXeroCsv } from "@/lib/integrations/accounting";
import { audit } from "@/server/audit";

export const runtime = "nodejs";

/** Xero sales invoice import CSV for invoices issued between ?from and ?to (Melbourne days). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!can(user, "update", "settings"))
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const search = new URL(req.url).searchParams;
  const range = parseDateRange({ from: search.get("from"), to: search.get("to") });
  const invoices = await db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ["DRAFT", "VOID"] },
      issueDate: { gte: range.from ?? undefined, lt: range.to ?? undefined },
    },
    include: { client: true, lineItems: { orderBy: { sortOrder: "asc" } } },
    orderBy: { number: "asc" },
  });
  await audit(db, {
    userId: user!.id,
    action: "EXPORT",
    entityType: "SETTINGS",
    entityId: "xero",
    changes: { count: invoices.length },
  });
  return new NextResponse(invoicesToXeroCsv(invoices), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="xero-invoices-${toDateInput(new Date())}.csv"`,
    },
  });
}
