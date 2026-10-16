import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { PdfDocument } from "@/lib/pdf/document";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatAddress } from "@/lib/utils";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import type { BusinessSettingsRecord } from "@/server/settings";
import { pdfBusiness } from "@/server/quotes/pdf";
import { bankDetailsLines } from "./service";
import type { InvoiceDetail } from "./queries";

function quantity(q: number) {
  return Number.isInteger(q) ? String(q) : q.toFixed(2);
}

/**
 * Renders a valid Australian tax invoice: the words "Tax Invoice", supplier name and
 * ABN, issue date, buyer identity (for invoices of $1,000 or more), a description of
 * each item with quantity and price, and the GST amount (or that the total includes GST).
 */
export async function renderInvoicePdf(
  invoice: Pick<
    InvoiceDetail,
    | "number"
    | "issueDate"
    | "dueDate"
    | "status"
    | "client"
    | "property"
    | "job"
    | "lineItems"
    | "subtotalCents"
    | "gstCents"
    | "totalCents"
    | "amountPaidCents"
    | "creditedCents"
    | "balanceCents"
    | "notes"
    | "payments"
  >,
  settings: BusinessSettingsRecord,
): Promise<Buffer> {
  const business = await pdfBusiness(settings);
  const client = invoice.client;
  const billLines = [
    client.companyName,
    client.abn ? `ABN ${client.abn}` : null,
    formatAddress({
      addressLine1: client.billingLine1,
      addressLine2: client.billingLine2,
      suburb: client.billingSuburb,
      state: client.billingState,
      postcode: client.billingPostcode,
    }),
    client.email,
  ].filter((l): l is string => !!l);
  const summary: { label: string; value: string; bold?: boolean }[] = [];
  for (const p of invoice.payments) {
    summary.push({
      label: `${p.amountCents < 0 ? "Refund" : "Payment"} ${formatDate(p.paidAt)} (${PAYMENT_METHOD_LABELS[p.method]})`,
      value: formatCents(-p.amountCents),
    });
  }
  if (invoice.creditedCents > 0)
    summary.push({ label: "Credits applied", value: formatCents(-invoice.creditedCents) });
  summary.push({
    label: "Balance due",
    value: formatCents(invoice.status === "VOID" ? 0 : invoice.balanceCents),
    bold: true,
  });

  return renderToBuffer(
    <PdfDocument
      kind="Invoice"
      business={business}
      number={invoice.number}
      meta={[
        { label: "Issue date", value: formatDate(invoice.issueDate) },
        { label: "Due date", value: formatDate(invoice.dueDate) },
        ...(invoice.job ? [{ label: "Job", value: invoice.job.number }] : []),
      ]}
      billTo={{ name: client.name, lines: billLines }}
      siteAddress={invoice.property ? formatAddress(invoice.property) : null}
      title={invoice.job?.title ?? null}
      sections={[
        {
          lines: invoice.lineItems.map((l) => ({
            description: l.description,
            quantity: quantity(l.quantity),
            unitPrice: formatCents(l.unitPriceCents),
            total: formatCents(l.totalCents),
            taxable: l.taxable,
          })),
          subtotal: formatCents(invoice.subtotalCents),
          gst: formatCents(invoice.gstCents),
          total: formatCents(invoice.totalCents),
        },
      ]}
      summary={summary}
      paymentDetails={[...bankDetailsLines(settings), `Reference: ${invoice.number}`]}
      notes={invoice.notes}
      footer={settings.invoiceFooter}
      stamp={invoice.status === "PAID" ? "PAID" : invoice.status === "VOID" ? "VOID" : null}
    />,
  );
}
