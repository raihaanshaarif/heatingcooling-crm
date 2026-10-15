import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getQuote } from "@/server/quotes/queries";
import { renderQuotePdf } from "@/server/quotes/pdf";
import { getSettings } from "@/server/settings";

export const runtime = "nodejs";

/** Quote PDF. Staff with quote access, or anyone holding the quote's public token (?token=). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token");
  const quote = await getQuote(id);
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!token || token !== quote.publicToken) {
    const user = await getCurrentUser();
    if (!can(user, "view", "quotes"))
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const pdf = await renderQuotePdf(quote, await getSettings());
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${quote.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
