import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getInvoice } from "@/server/invoices/queries";
import { renderInvoicePdf } from "@/server/invoices/pdf";
import { getSettings } from "@/server/settings";

export const runtime = "nodejs";

/** Tax invoice PDF. Staff with invoice access, or anyone holding the invoice's public token (?token=). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token");
  const invoice = await getInvoice(id);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!token || token !== invoice.publicToken || invoice.status === "DRAFT") {
    const user = await getCurrentUser();
    if (!can(user, "view", "invoices"))
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const pdf = await renderInvoicePdf(invoice, await getSettings());
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
