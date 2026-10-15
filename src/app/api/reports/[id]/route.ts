import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { toDateInput } from "@/lib/dates";
import { resolveRange } from "@/server/reports/range";
import {
  COST_REPORTS,
  REPORT_IDS,
  getReport,
  reportToCsv,
  type ReportId,
} from "@/server/reports/queries";
import { audit } from "@/server/audit";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** CSV export of any report: /api/reports/<id>?from=yyyy-MM-dd&to=yyyy-MM-dd */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!can(user, "view", "reports"))
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await params;
  if (!(REPORT_IDS as readonly string[]).includes(id))
    return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  if (COST_REPORTS.includes(id as ReportId) && !can(user, "view", "priceBookCosts"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const search = new URL(req.url).searchParams;
  const range = resolveRange({
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
  });
  const report = await getReport(id as ReportId, range);
  await audit(db, {
    userId: user!.id,
    action: "EXPORT",
    entityType: "SETTINGS",
    entityId: id,
    changes: { from: range.from, to: range.to },
  });
  const filename = `${id}_${toDateInput(range.from)}_${toDateInput(new Date(range.to.getTime() - 1))}.csv`;
  return new NextResponse(reportToCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
