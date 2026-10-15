import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { PdfDocument, type PdfBusiness } from "@/lib/pdf/document";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatAddress } from "@/lib/utils";
import { keyFromUrl, readFileByKey } from "@/lib/storage";
import type { BusinessSettingsRecord } from "@/server/settings";
import type { QuoteDetail } from "./queries";

export async function pdfBusiness(settings: BusinessSettingsRecord): Promise<PdfBusiness> {
  let logo: PdfBusiness["logo"] = null;
  const key = settings.logoUrl ? keyFromUrl(settings.logoUrl) : null;
  if (key && /\.(png|jpe?g)$/i.test(key)) {
    const data = await readFileByKey(key);
    if (data) logo = { data, format: /\.png$/i.test(key) ? "png" : "jpg" };
  }
  return {
    businessName: settings.businessName,
    tradingName: settings.tradingName,
    abn: settings.abn,
    email: settings.email,
    phone: settings.phone,
    website: settings.website,
    address: formatAddress(settings),
    logo,
    gstRegistered: settings.gstRegistered,
  };
}

function quantity(q: number) {
  return Number.isInteger(q) ? String(q) : q.toFixed(2);
}

export async function renderQuotePdf(
  quote: QuoteDetail,
  settings: BusinessSettingsRecord,
): Promise<Buffer> {
  const business = await pdfBusiness(settings);
  const client = quote.client;
  const billLines = [
    client.companyName,
    formatAddress({
      addressLine1: client.billingLine1,
      addressLine2: client.billingLine2,
      suburb: client.billingSuburb,
      state: client.billingState,
      postcode: client.billingPostcode,
    }),
    client.email,
    client.phone,
  ].filter((l): l is string => !!l);
  const multi = quote.options.length > 1;
  return renderToBuffer(
    <PdfDocument
      kind="Quote"
      business={business}
      number={quote.number}
      meta={[
        { label: "Date", value: formatDate(quote.sentAt ?? quote.createdAt) },
        ...(quote.validUntil
          ? [{ label: "Valid until", value: formatDate(quote.validUntil) }]
          : []),
      ]}
      billTo={{ name: client.name, lines: billLines }}
      siteAddress={quote.property ? formatAddress(quote.property) : null}
      title={quote.title}
      intro={
        [
          quote.intro,
          multi
            ? "This quote includes several options. Choose the one that suits you best when you accept."
            : null,
        ]
          .filter(Boolean)
          .join("\n\n") || null
      }
      sections={quote.options.map((o) => ({
        heading: multi ? o.name : undefined,
        description: o.description,
        highlight: quote.selectedOptionId === o.id,
        lines: o.lineItems.map((l) => ({
          description: l.description,
          quantity: quantity(l.quantity),
          unitPrice: formatCents(l.unitPriceCents),
          total: formatCents(l.totalCents),
          taxable: l.taxable,
        })),
        subtotal: formatCents(o.subtotalCents),
        gst: formatCents(o.gstCents),
        total: formatCents(o.totalCents),
      }))}
      terms={quote.terms}
      footer={settings.invoiceFooter}
      stamp={
        quote.status === "ACCEPTED"
          ? "ACCEPTED"
          : quote.status === "DECLINED"
            ? "DECLINED"
            : quote.status === "EXPIRED"
              ? "EXPIRED"
              : null
      }
    />,
  );
}
