import { toDateInput } from "@/lib/dates";

/**
 * Pure builders for the Xero Accounting API payloads (contacts, ACCREC invoices,
 * ACCRECCREDIT credit notes, allocations, payments). Money in CoolOps is integer cents,
 * unit prices are ex GST, and GST is calculated once on the taxable subtotal; Xero
 * calculates tax per line. To make Xero's totals match CoolOps to the cent, every line
 * carries an explicit LineAmount and TaxAmount (Xero accepts a TaxAmount override), and
 * the invoice's GST is spread across the taxable lines so they add up exactly.
 */

export interface XeroMapping {
  salesAccountCode: string;
  taxTypeTaxable: string;
  taxTypeFree: string;
  invoiceStatus: "AUTHORISED" | "DRAFT";
  bankAccountId?: string | null;
  bankAccountCode?: string | null;
}

/** Cents → a 2dp number for Xero ("1234" → 12.34). */
export function toAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/** Xero takes plain dates; CoolOps dates are Melbourne days. */
export function xeroDate(date: Date): string {
  return toDateInput(date);
}

const clip = (value: string | null | undefined, max: number) =>
  value ? value.trim().slice(0, max) : undefined;

// ─── Contacts ────────────────────────────────────────────────────────────────

export interface ClientForXero {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  abn?: string | null;
  billingLine1?: string | null;
  billingLine2?: string | null;
  billingSuburb?: string | null;
  billingState?: string | null;
  billingPostcode?: string | null;
}

const isMobile = (phone: string) => /^(\+?61|0)4/.test(phone.replace(/[\s()-]/g, ""));

export function buildContactPayload(client: ClientForXero, contactId?: string | null) {
  const phones: { PhoneType: "DEFAULT" | "MOBILE"; PhoneNumber: string }[] = [];
  for (const raw of [client.phone, client.altPhone]) {
    const phone = raw?.trim();
    if (!phone) continue;
    const type = isMobile(phone) ? "MOBILE" : "DEFAULT";
    if (!phones.some((p) => p.PhoneType === type))
      phones.push({ PhoneType: type, PhoneNumber: phone });
  }
  const hasAddress = client.billingLine1 || client.billingSuburb || client.billingPostcode;
  return {
    ...(contactId ? { ContactID: contactId } : {}),
    Name: clip(client.name, 255)!,
    // Xero shows ContactNumber as read-only: it ties the contact back to the CoolOps client.
    ContactNumber: client.id,
    ...(client.email ? { EmailAddress: clip(client.email, 255) } : {}),
    ...(client.abn ? { TaxNumber: client.abn.replace(/\D/g, "") } : {}),
    ...(phones.length ? { Phones: phones } : {}),
    ...(hasAddress
      ? {
          Addresses: [
            {
              AddressType: "POBOX",
              AddressLine1: clip(client.billingLine1, 500),
              AddressLine2: clip(client.billingLine2, 500),
              City: clip(client.billingSuburb, 255),
              Region: clip(client.billingState, 255),
              PostalCode: clip(client.billingPostcode, 50),
              Country: "Australia",
            },
          ],
        }
      : {}),
  };
}

export interface XeroContactSummary {
  ContactID: string;
  Name?: string;
  EmailAddress?: string;
  ContactNumber?: string;
  ContactStatus?: string;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Find the existing Xero contact for a client: one already tagged with this client's id,
 * else the same email, else the same name. Archived contacts are ignored.
 */
export function matchContact(
  contacts: XeroContactSummary[],
  client: Pick<ClientForXero, "id" | "name" | "email">,
): XeroContactSummary | null {
  const active = contacts.filter((c) => (c.ContactStatus ?? "ACTIVE") === "ACTIVE");
  return (
    active.find((c) => c.ContactNumber === client.id) ??
    (client.email ? active.find((c) => norm(c.EmailAddress) === norm(client.email)) : undefined) ??
    active.find((c) => norm(c.Name) === norm(client.name)) ??
    null
  );
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export interface LineForXero {
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  taxable: boolean;
}

export interface InvoiceForXero {
  number: string;
  issueDate: Date;
  dueDate: Date;
  jobNumber?: string | null;
  gstCents: number;
  lineItems: LineForXero[];
}

/**
 * Split the invoice GST over its taxable lines so the parts add up to exactly `gstCents`
 * (largest remainder on each line's exact 10%). GST-free lines get 0.
 */
export function distributeGst(
  lines: Pick<LineForXero, "totalCents" | "taxable">[],
  gstCents: number,
): number[] {
  const taxes = lines.map(() => 0);
  const taxable = lines
    .map((l, i) => ({ i, total: l.totalCents }))
    .filter((_, i) => lines[i]!.taxable);
  if (gstCents === 0 || taxable.length === 0) return taxes;
  const parts = taxable.map(({ i, total }) => {
    const floor = Math.floor(total / 10);
    return { i, floor, frac: total - floor * 10 };
  });
  for (const p of parts) taxes[p.i] = p.floor;
  let remainder = gstCents - parts.reduce((s, p) => s + p.floor, 0);
  const order = [...parts].sort((a, b) => b.frac - a.frac || a.i - b.i);
  // Normally 0 ≤ remainder ≤ lines; loop guards against totals that don't come from calculateTotals.
  for (let k = 0; remainder !== 0; k = (k + 1) % order.length) {
    const step = remainder > 0 ? 1 : -1;
    taxes[order[k]!.i] += step;
    remainder -= step;
  }
  return taxes;
}

export function buildInvoicePayload(
  invoice: InvoiceForXero,
  opts: {
    contactId: string;
    xeroInvoiceId?: string | null;
    status: "AUTHORISED" | "DRAFT";
    mapping: Pick<XeroMapping, "salesAccountCode" | "taxTypeTaxable" | "taxTypeFree">;
    gstRegistered: boolean;
  },
) {
  const gst = opts.gstRegistered ? invoice.gstCents : 0;
  const taxes = distributeGst(invoice.lineItems, gst);
  return {
    ...(opts.xeroInvoiceId ? { InvoiceID: opts.xeroInvoiceId } : {}),
    Type: "ACCREC" as const,
    Contact: { ContactID: opts.contactId },
    InvoiceNumber: invoice.number,
    ...(invoice.jobNumber ? { Reference: invoice.jobNumber } : {}),
    Date: xeroDate(invoice.issueDate),
    DueDate: xeroDate(invoice.dueDate),
    LineAmountTypes: "Exclusive" as const,
    CurrencyCode: "AUD",
    Status: opts.status,
    LineItems: invoice.lineItems.map((l, i) => {
      const taxed = opts.gstRegistered && l.taxable;
      return {
        Description: clip(l.description, 4000) || "Item",
        Quantity: Number(l.quantity),
        UnitAmount: toAmount(l.unitPriceCents),
        LineAmount: toAmount(l.totalCents),
        AccountCode: opts.mapping.salesAccountCode,
        TaxType: taxed ? opts.mapping.taxTypeTaxable : opts.mapping.taxTypeFree,
        TaxAmount: toAmount(taxed ? taxes[i]! : 0),
      };
    }),
  };
}

// ─── Credit notes ────────────────────────────────────────────────────────────

export interface CreditNoteForXero {
  number: string;
  issuedAt: Date;
  reason: string;
  /** Amount credited, GST inclusive (it reduces the invoice balance). */
  amountCents: number;
  invoice: {
    number: string;
    totalCents: number;
    gstCents: number;
    /** Sum of the taxable lines ex GST. */
    taxableCents: number;
  };
}

/**
 * ACCRECCREDIT credit note. CoolOps credits are a GST-inclusive amount; on an invoice with
 * both taxable and GST-free lines the credit is split in the same proportion.
 */
export function buildCreditNotePayload(
  note: CreditNoteForXero,
  opts: {
    contactId: string;
    xeroCreditNoteId?: string | null;
    status: "AUTHORISED" | "DRAFT";
    mapping: Pick<XeroMapping, "salesAccountCode" | "taxTypeTaxable" | "taxTypeFree">;
    gstRegistered: boolean;
  },
) {
  const inv = note.invoice;
  const taxablePortion =
    opts.gstRegistered && inv.gstCents > 0 ? inv.taxableCents + inv.gstCents : 0;
  const taxableCredit =
    inv.totalCents > 0 && taxablePortion > 0
      ? Math.min(note.amountCents, Math.round((note.amountCents * taxablePortion) / inv.totalCents))
      : 0;
  const freeCredit = note.amountCents - taxableCredit;
  const description = clip(`Credit for ${inv.number}: ${note.reason}`, 4000)!;
  const lines = [
    taxableCredit > 0 && {
      Description: description,
      Quantity: 1,
      UnitAmount: toAmount(taxableCredit),
      LineAmount: toAmount(taxableCredit),
      AccountCode: opts.mapping.salesAccountCode,
      TaxType: opts.mapping.taxTypeTaxable,
      TaxAmount: toAmount(Math.round(taxableCredit / 11)),
    },
    freeCredit > 0 && {
      Description: taxableCredit > 0 ? `${description} (GST free part)` : description,
      Quantity: 1,
      UnitAmount: toAmount(freeCredit),
      LineAmount: toAmount(freeCredit),
      AccountCode: opts.mapping.salesAccountCode,
      TaxType: opts.mapping.taxTypeFree,
      TaxAmount: 0,
    },
  ].filter(Boolean);
  return {
    ...(opts.xeroCreditNoteId ? { CreditNoteID: opts.xeroCreditNoteId } : {}),
    Type: "ACCRECCREDIT" as const,
    Contact: { ContactID: opts.contactId },
    CreditNoteNumber: note.number,
    Reference: inv.number,
    Date: xeroDate(note.issuedAt),
    LineAmountTypes: "Inclusive" as const,
    CurrencyCode: "AUD",
    Status: opts.status,
    LineItems: lines,
  };
}

export function buildAllocationPayload(xeroInvoiceId: string, amountCents: number, date: Date) {
  return {
    Allocations: [
      {
        Invoice: { InvoiceID: xeroInvoiceId },
        Amount: toAmount(amountCents),
        Date: xeroDate(date),
      },
    ],
  };
}

/** Allocate as much of the credit as the invoice still owes in Xero (the rest stays as credit). */
export function allocationAmountCents(remainingCredit: number, invoiceAmountDue: number): number {
  return Math.max(
    0,
    Math.min(Math.round(remainingCredit * 100), Math.round(invoiceAmountDue * 100)),
  );
}

// ─── Payments ────────────────────────────────────────────────────────────────

export interface PaymentForXero {
  amountCents: number; // negative = refund
  paidAt: Date;
  reference?: string | null;
  methodLabel: string;
  invoiceNumber: string;
}

/** The bank account a payment goes into: by AccountID when picked from Xero, else by code. */
export function paymentAccount(mapping: Pick<XeroMapping, "bankAccountId" | "bankAccountCode">) {
  if (mapping.bankAccountId) return { AccountID: mapping.bankAccountId };
  if (mapping.bankAccountCode) return { Code: mapping.bankAccountCode };
  return null;
}

/**
 * A payment against the invoice, or, for a refund (negative amount), money paid out
 * against a credit note on that invoice (Xero has no negative invoice payments).
 */
export function buildPaymentPayload(
  payment: PaymentForXero,
  target: { invoiceId: string } | { creditNoteId: string },
  account: { AccountID: string } | { Code: string },
) {
  const reference = [payment.methodLabel, payment.reference].filter(Boolean).join(" ");
  return {
    ...("invoiceId" in target
      ? { Invoice: { InvoiceID: target.invoiceId } }
      : { CreditNote: { CreditNoteID: target.creditNoteId } }),
    Account: account,
    Date: xeroDate(payment.paidAt),
    Amount: toAmount(Math.abs(payment.amountCents)),
    Reference: clip(
      payment.amountCents < 0 ? `Refund ${payment.invoiceNumber} ${reference}` : reference,
      255,
    ),
  };
}

// ─── Responses ───────────────────────────────────────────────────────────────

/** First element of a Xero collection response, e.g. first(json, "Invoices"). */
export function firstOf<T = Record<string, unknown>>(json: unknown, key: string): T | null {
  const list = (json as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) && list.length ? (list[0] as T) : null;
}

export function listOf<T = Record<string, unknown>>(json: unknown, key: string): T[] {
  const list = (json as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) ? (list as T[]) : [];
}

export const XERO_DEAD_STATUSES = ["DELETED", "VOIDED"];

/** Escape a value for a Xero `where` filter string literal. */
export function whereString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Deep links into Xero (the organisation is the one the user is signed into). */
export const xeroLinks = {
  invoice: (id: string) => `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${id}`,
  contact: (id: string) => `https://go.xero.com/Contacts/View/${id}`,
  creditNote: (id: string) =>
    `https://go.xero.com/AccountsReceivable/ViewCreditNote.aspx?creditNoteID=${id}`,
};
