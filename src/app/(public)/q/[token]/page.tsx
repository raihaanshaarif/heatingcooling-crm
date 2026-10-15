import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatAddress } from "@/lib/utils";
import { getQuoteByToken } from "@/server/quotes/queries";
import { getSettings } from "@/server/settings";
import { logActivity, notifyRoles } from "@/server/audit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BusinessHeader } from "@/components/public/business-header";
import { QuoteDecision } from "@/components/public/quote-decision";

export const metadata: Metadata = { title: "Your quote", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let quote = await getQuoteByToken(token);
  if (!quote || quote.status === "DRAFT") notFound();
  const settings = await getSettings();

  // First open by the client: mark as viewed and let the office know.
  if (quote.status === "SENT") {
    await db.$transaction(async (tx) => {
      const updated = await tx.quote.updateMany({
        where: { id: quote!.id, status: "SENT" },
        data: { status: "VIEWED", viewedAt: new Date() },
      });
      if (updated.count > 0) {
        await logActivity(tx, {
          entityType: "QUOTE",
          entityId: quote!.id,
          type: "SYSTEM",
          body: "Client opened the quote",
        });
        await notifyRoles(tx, ["ADMIN", "OFFICE"], {
          title: `Quote ${quote!.number} viewed`,
          body: quote!.client.name,
          link: `/quotes/${quote!.id}`,
        });
      }
    });
    quote = (await getQuoteByToken(token))!;
  }
  const expired =
    quote.status === "EXPIRED" ||
    (!!quote.validUntil &&
      quote.validUntil.getTime() < Date.now() - 86_400_000 &&
      quote.status !== "ACCEPTED");
  const multi = quote.options.length > 1;

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <BusinessHeader settings={settings} />
      <Card>
        <CardContent className="space-y-1">
          <p className="text-muted-foreground text-sm">Quote {quote.number}</p>
          <h1 className="text-2xl font-semibold">{quote.title}</h1>
          <p className="text-sm">
            Prepared for <strong>{quote.client.name}</strong>
            {quote.property && <> · {formatAddress(quote.property)}</>}
          </p>
          <p className="text-muted-foreground text-sm">
            {quote.sentAt && <>Issued {formatDate(quote.sentAt)}</>}
            {quote.validUntil && <> · Valid until {formatDate(quote.validUntil)}</>}
          </p>
          {quote.intro && <p className="pt-3 text-sm whitespace-pre-line">{quote.intro}</p>}
        </CardContent>
      </Card>

      {quote.options.map((o) => (
        <Card
          key={o.id}
          className={
            quote.selectedOptionId === o.id
              ? "border-emerald-500 ring-1 ring-emerald-500"
              : undefined
          }
        >
          <CardContent className="space-y-3">
            {multi && (
              <div>
                <h2 className="text-lg font-semibold">{o.name}</h2>
                {o.description && <p className="text-muted-foreground text-sm">{o.description}</p>}
              </div>
            )}
            <ul className="divide-y text-sm">
              {o.lineItems.map((l) => (
                <li key={l.id} className="flex justify-between gap-4 py-2">
                  <span>
                    {l.description}
                    {l.quantity !== 1 && (
                      <span className="text-muted-foreground"> × {l.quantity}</span>
                    )}
                  </span>
                  <span className="tabular-nums">{formatCents(l.totalCents)}</span>
                </li>
              ))}
            </ul>
            <dl className="ml-auto grid max-w-64 grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="text-right tabular-nums">{formatCents(o.subtotalCents)}</dd>
              {settings.gstRegistered && (
                <>
                  <dt className="text-muted-foreground">GST</dt>
                  <dd className="text-right tabular-nums">{formatCents(o.gstCents)}</dd>
                </>
              )}
              <dt className="border-t pt-1 font-semibold">
                Total{settings.gstRegistered ? " inc GST" : ""}
              </dt>
              <dd className="border-t pt-1 text-right font-semibold tabular-nums">
                {formatCents(o.totalCents)}
              </dd>
            </dl>
          </CardContent>
        </Card>
      ))}

      <QuoteDecision
        token={token}
        status={quote.status}
        expired={expired}
        options={quote.options.map((o) => ({ id: o.id, name: o.name, totalCents: o.totalCents }))}
        selectedOptionId={quote.selectedOptionId}
        businessPhone={settings.phone}
      />

      <div className="flex justify-center">
        <Button asChild variant="outline">
          <a href={`/api/pdf/quote/${quote.id}?token=${token}`} target="_blank" rel="noreferrer">
            <Download /> Download PDF
          </a>
        </Button>
      </div>
      {quote.terms && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Terms and conditions</summary>
          <p className="text-muted-foreground mt-2 text-xs whitespace-pre-line">{quote.terms}</p>
        </details>
      )}
    </main>
  );
}
