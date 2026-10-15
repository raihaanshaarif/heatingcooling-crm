import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Accounting export: a Xero-compatible sales invoice CSV (Xero → Business → Invoices →
 * Import), also the route for MYOB. Live one-way sync to Xero over the Accounting API
 * lives in src/lib/xero (pure payloads, OAuth, client) and src/server/xero (queue, sync).
 */
type InvoiceForExport = Prisma.InvoiceGetPayload<{ include: { client: true; lineItems: true } }>;

const XERO_HEADERS = [
  "*ContactName",
  "EmailAddress",
  "*InvoiceNumber",
  "*InvoiceDate",
  "*DueDate",
  "*Description",
  "*Quantity",
  "*UnitAmount",
  "*AccountCode",
  "*TaxType",
  "Currency",
];

function cell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function auDate(d: Date) {
  return d.toLocaleDateString("en-AU", {
    timeZone: "Australia/Melbourne",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Xero sales invoice import. Unit amounts are ex GST ("Tax Exclusive"); GST lines use "GST on Income". */
export function invoicesToXeroCsv(invoices: InvoiceForExport[], salesAccountCode = "200"): string {
  const rows = [XERO_HEADERS.join(",")];
  for (const inv of invoices) {
    for (const line of inv.lineItems) {
      rows.push(
        [
          inv.client.name,
          inv.client.email,
          inv.number,
          auDate(inv.issueDate),
          auDate(inv.dueDate),
          line.description,
          Number(line.quantity).toString(),
          (line.unitPriceCents / 100).toFixed(2),
          salesAccountCode,
          line.taxable && inv.gstCents > 0 ? "GST on Income" : "GST Free Income",
          "AUD",
        ]
          .map(cell)
          .join(","),
      );
    }
  }
  return rows.join("\r\n") + "\r\n";
}

/** MYOB has no live sync: export the CSV above and import it into MYOB. */
export function invoicesToMyob(): never {
  throw new Error("MYOB uses the CSV export (/api/export/xero); there is no live MYOB sync.");
}
