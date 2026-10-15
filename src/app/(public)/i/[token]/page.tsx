import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreditCard, Download } from "lucide-react";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatAddress } from "@/lib/utils";
import { getInvoiceByToken } from "@/server/invoices/queries";
import { bankDetailsLines } from "@/server/invoices/service";
import { getSettings } from "@/server/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InvoiceStatusBadge } from "@/components/shared/status-badge";
import { BusinessHeader } from "@/components/public/business-header";

export const metadata: Metadata = { title: "Your invoice", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invoice = await getInvoiceByToken(token);
  if (!invoice) notFound();
  const settings = await getSettings();
  const bank = bankDetailsLines(settings);
  const open = invoice.status !== "VOID" && invoice.balanceCents > 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <BusinessHeader settings={settings} />
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">
              {settings.gstRegistered ? "Tax invoice" : "Invoice"}
            </p>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              {invoice.number} <InvoiceStatusBadge status={invoice.status} />
            </h1>
            <p className="text-sm">
              For <strong>{invoice.client.name}</strong>
              {invoice.property && <> · {formatAddress(invoice.property)}</>}
            </p>
            <p className="text-muted-foreground text-sm">
              Issued {formatDate(invoice.issueDate)} · Due {formatDate(invoice.dueDate)}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-muted-foreground text-sm">Balance due</p>
            <p className="text-3xl font-semibold tabular-nums">
              {formatCents(invoice.status === "VOID" ? 0 : invoice.balanceCents)}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3">
          <ul className="divide-y text-sm">
            {invoice.lineItems.map((l) => (
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
          <dl className="ml-auto grid max-w-xs grid-cols-2 gap-1 border-t pt-3 text-sm">
            <dt>Subtotal</dt>
            <dd className="text-right tabular-nums">{formatCents(invoice.subtotalCents)}</dd>
            {settings.gstRegistered && (
              <>
                <dt>GST</dt>
                <dd className="text-right tabular-nums">{formatCents(invoice.gstCents)}</dd>
              </>
            )}
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold tabular-nums">
              {formatCents(invoice.totalCents)}
            </dd>
            {invoice.amountPaidCents !== 0 && (
              <>
                <dt>Paid</dt>
                <dd className="text-right tabular-nums">{formatCents(-invoice.amountPaidCents)}</dd>
              </>
            )}
            {invoice.creditedCents !== 0 && (
              <>
                <dt>Credited</dt>
                <dd className="text-right tabular-nums">{formatCents(-invoice.creditedCents)}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>
      {open && (
        <Card>
          <CardHeader>
            <CardTitle>How to pay</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {bank.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">Bank transfer</p>
                {bank.map((l) => (
                  <p key={l}>{l}</p>
                ))}
                <p>Reference: {invoice.number}</p>
              </div>
            )}
            {/* TODO(Phase 2): Stripe "Pay now" button using invoice.stripePaymentLinkUrl (see src/lib/payments/stripe.ts). */}
            {invoice.stripePaymentLinkUrl ? (
              <Button asChild size="lg">
                <a href={invoice.stripePaymentLinkUrl}>
                  <CreditCard /> Pay now by card
                </a>
              </Button>
            ) : (
              <p className="text-muted-foreground">
                Card payments online are coming soon. Call us to pay by card over the phone.
              </p>
            )}
          </CardContent>
        </Card>
      )}
      <div className="flex justify-center">
        <Button asChild variant="outline">
          <a
            href={`/api/pdf/invoice/${invoice.id}?token=${token}`}
            target="_blank"
            rel="noreferrer"
          >
            <Download /> Download PDF
          </a>
        </Button>
      </div>
      {settings.invoiceFooter && (
        <p className="text-muted-foreground text-center text-xs whitespace-pre-line">
          {settings.invoiceFooter}
        </p>
      )}
    </main>
  );
}
