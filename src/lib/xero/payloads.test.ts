import { describe, expect, it } from "vitest";
import { calculateTotals, lineTotalCents } from "@/lib/money";
import {
  allocationAmountCents,
  buildAllocationPayload,
  buildContactPayload,
  buildCreditNotePayload,
  buildInvoicePayload,
  buildPaymentPayload,
  distributeGst,
  matchContact,
  paymentAccount,
  toAmount,
  whereString,
  xeroDate,
} from "./payloads";

const mapping = {
  salesAccountCode: "200",
  taxTypeTaxable: "OUTPUT",
  taxTypeFree: "EXEMPTOUTPUT",
};

function line(description: string, quantity: number, unitPriceCents: number, taxable = true) {
  return {
    description,
    quantity,
    unitPriceCents,
    taxable,
    totalCents: lineTotalCents(quantity, unitPriceCents),
  };
}

describe("helpers", () => {
  it("converts cents and Melbourne dates", () => {
    expect(toAmount(12345)).toBe(123.45);
    expect(toAmount(-500)).toBe(-5);
    // 1:30am on the 15th in Melbourne is still the 14th in UTC.
    expect(xeroDate(new Date("2026-10-14T14:30:00Z"))).toBe("2026-10-15");
  });

  it("escapes where-filter strings", () => {
    expect(whereString("CN-0001")).toBe('"CN-0001"');
    expect(whereString('Say "hi"')).toBe('"Say \\"hi\\""');
  });
});

describe("buildContactPayload", () => {
  it("maps a client to a Xero contact", () => {
    expect(
      buildContactPayload({
        id: "client_1",
        name: "Sarah Nguyen",
        email: "sarah@example.com",
        phone: "0412 345 678",
        altPhone: "(03) 9123 4567",
        abn: "51 824 753 556",
        billingLine1: "12 Smith St",
        billingLine2: null,
        billingSuburb: "Brunswick",
        billingState: "VIC",
        billingPostcode: "3056",
      }),
    ).toEqual({
      Name: "Sarah Nguyen",
      ContactNumber: "client_1",
      EmailAddress: "sarah@example.com",
      TaxNumber: "51824753556",
      Phones: [
        { PhoneType: "MOBILE", PhoneNumber: "0412 345 678" },
        { PhoneType: "DEFAULT", PhoneNumber: "(03) 9123 4567" },
      ],
      Addresses: [
        {
          AddressType: "POBOX",
          AddressLine1: "12 Smith St",
          AddressLine2: undefined,
          City: "Brunswick",
          Region: "VIC",
          PostalCode: "3056",
          Country: "Australia",
        },
      ],
    });
  });

  it("includes the ContactID for an update and leaves out empty details", () => {
    expect(buildContactPayload({ id: "c2", name: "Acme Pty Ltd" }, "xero-contact-1")).toEqual({
      ContactID: "xero-contact-1",
      Name: "Acme Pty Ltd",
      ContactNumber: "c2",
    });
  });
});

describe("matchContact", () => {
  const contacts = [
    { ContactID: "a", Name: "Sarah Nguyen", EmailAddress: "old@example.com" },
    { ContactID: "b", Name: "S Nguyen", EmailAddress: "SARAH@example.com" },
    {
      ContactID: "c",
      Name: "Archived Sarah",
      EmailAddress: "sarah@example.com",
      ContactStatus: "ARCHIVED",
    },
    { ContactID: "d", Name: "Someone", ContactNumber: "client_9" },
  ];

  it("prefers our own client id, then email, then name", () => {
    expect(matchContact(contacts, { id: "client_9", name: "X", email: null })?.ContactID).toBe("d");
    expect(
      matchContact(contacts, { id: "x", name: "Sarah Nguyen", email: "sarah@example.com" })
        ?.ContactID,
    ).toBe("b");
    expect(
      matchContact(contacts, { id: "x", name: " sarah  nguyen ", email: null })?.ContactID,
    ).toBe("a");
  });

  it("ignores archived contacts and returns null when nothing matches", () => {
    expect(matchContact(contacts, { id: "x", name: "Archived Sarah", email: null })).toBeNull();
    expect(matchContact([], { id: "x", name: "Nobody", email: "n@example.com" })).toBeNull();
  });
});

describe("distributeGst", () => {
  it("adds up to the document GST where per-line rounding would not", () => {
    const lines = [line("a", 1, 105), line("b", 1, 105), line("c", 1, 105)];
    const { gstCents } = calculateTotals(lines);
    expect(gstCents).toBe(32); // 10% of $3.15, rounded once
    const taxes = distributeGst(lines, gstCents);
    expect(taxes).toEqual([11, 11, 10]); // per-line rounding would give 33
    expect(taxes.reduce((a, b) => a + b, 0)).toBe(32);
  });

  it("gives GST-free lines no tax and copes with negative lines", () => {
    const lines = [
      line("Install", 1, 250000),
      line("Less deposit", 1, -75005),
      line("Permit", 1, 4500, false),
    ];
    const { gstCents } = calculateTotals(lines);
    const taxes = distributeGst(lines, gstCents);
    expect(taxes[2]).toBe(0);
    expect(taxes[0]! + taxes[1]!).toBe(gstCents);
    expect(distributeGst(lines, 0)).toEqual([0, 0, 0]);
  });
});

describe("buildInvoicePayload", () => {
  const lines = [
    line("Labour (hours)", 1.5, 9533), // 142.995 → $143.00
    line("Run capacitor 45/5uF", 3, 1235),
    line("Council permit fee", 1, 5000, false),
  ];
  const totals = calculateTotals(lines);
  const invoice = {
    number: "INV-0042",
    issueDate: new Date("2026-10-14T23:00:00Z"),
    dueDate: new Date("2026-10-28T23:00:00Z"),
    jobNumber: "J-0107",
    gstCents: totals.gstCents,
    lineItems: lines,
  };

  it("builds an ACCREC invoice with ex-GST amounts and tax types per line", () => {
    const payload = buildInvoicePayload(invoice, {
      contactId: "contact-1",
      status: "AUTHORISED",
      mapping,
      gstRegistered: true,
    });
    expect(payload).toMatchObject({
      Type: "ACCREC",
      Contact: { ContactID: "contact-1" },
      InvoiceNumber: "INV-0042",
      Reference: "J-0107",
      Date: "2026-10-15",
      DueDate: "2026-10-29",
      LineAmountTypes: "Exclusive",
      CurrencyCode: "AUD",
      Status: "AUTHORISED",
    });
    expect(payload).not.toHaveProperty("InvoiceID");
    expect(payload.LineItems).toEqual([
      {
        Description: "Labour (hours)",
        Quantity: 1.5,
        UnitAmount: 95.33,
        LineAmount: 143,
        AccountCode: "200",
        TaxType: "OUTPUT",
        TaxAmount: 14.3,
      },
      {
        Description: "Run capacitor 45/5uF",
        Quantity: 3,
        UnitAmount: 12.35,
        LineAmount: 37.05,
        AccountCode: "200",
        TaxType: "OUTPUT",
        TaxAmount: 3.71,
      },
      {
        Description: "Council permit fee",
        Quantity: 1,
        UnitAmount: 50,
        LineAmount: 50,
        AccountCode: "200",
        TaxType: "EXEMPTOUTPUT",
        TaxAmount: 0,
      },
    ]);
  });

  it("matches CoolOps totals to the cent", () => {
    const payload = buildInvoicePayload(invoice, {
      contactId: "c",
      status: "AUTHORISED",
      mapping,
      gstRegistered: true,
    });
    const cents = (n: number) => Math.round(n * 100);
    const sub = payload.LineItems.reduce((s, l) => s + cents(l.LineAmount), 0);
    const tax = payload.LineItems.reduce((s, l) => s + cents(l.TaxAmount), 0);
    expect(sub).toBe(totals.subtotalCents);
    expect(tax).toBe(totals.gstCents);
    expect(sub + tax).toBe(totals.totalCents);
  });

  it("updates by InvoiceID, pushes drafts, and uses GST-free when not registered", () => {
    const payload = buildInvoicePayload(
      { ...invoice, jobNumber: null },
      {
        contactId: "c",
        xeroInvoiceId: "inv-xero-1",
        status: "DRAFT",
        mapping,
        gstRegistered: false,
      },
    );
    expect(payload.InvoiceID).toBe("inv-xero-1");
    expect(payload.Status).toBe("DRAFT");
    expect(payload).not.toHaveProperty("Reference");
    expect(payload.LineItems.every((l) => l.TaxType === "EXEMPTOUTPUT" && l.TaxAmount === 0)).toBe(
      true,
    );
  });
});

describe("buildCreditNotePayload", () => {
  const base = {
    number: "CN-0003",
    issuedAt: new Date("2026-10-15T02:00:00Z"),
    reason: "Goodwill discount",
    amountCents: 11000,
    invoice: { number: "INV-0042", totalCents: 55000, gstCents: 5000, taxableCents: 50000 },
  };

  it("credits a GST-inclusive amount on an all-taxable invoice", () => {
    const payload = buildCreditNotePayload(base, {
      contactId: "c",
      status: "AUTHORISED",
      mapping,
      gstRegistered: true,
    });
    expect(payload).toMatchObject({
      Type: "ACCRECCREDIT",
      CreditNoteNumber: "CN-0003",
      Reference: "INV-0042",
      Date: "2026-10-15",
      LineAmountTypes: "Inclusive",
      Status: "AUTHORISED",
    });
    expect(payload.LineItems).toEqual([
      {
        Description: "Credit for INV-0042: Goodwill discount",
        Quantity: 1,
        UnitAmount: 110,
        LineAmount: 110,
        AccountCode: "200",
        TaxType: "OUTPUT",
        TaxAmount: 10,
      },
    ]);
  });

  it("splits the credit when the invoice has GST-free lines", () => {
    // $440 taxable inc GST + $60 GST free = $500. Credit $100 → $88 taxable, $12 free.
    const payload = buildCreditNotePayload(
      {
        ...base,
        amountCents: 10000,
        invoice: { number: "INV-1", totalCents: 50000, gstCents: 4000, taxableCents: 40000 },
      },
      { contactId: "c", status: "AUTHORISED", mapping, gstRegistered: true },
    );
    const lines = payload.LineItems as { LineAmount: number; TaxType: string; TaxAmount: number }[];
    expect(lines.map((l) => [l.LineAmount, l.TaxType, l.TaxAmount])).toEqual([
      [88, "OUTPUT", 8],
      [12, "EXEMPTOUTPUT", 0],
    ]);
  });

  it("is all GST free on an invoice without GST", () => {
    const payload = buildCreditNotePayload(
      {
        ...base,
        invoice: { number: "INV-2", totalCents: 50000, gstCents: 0, taxableCents: 50000 },
      },
      { contactId: "c", status: "DRAFT", mapping, gstRegistered: true },
    );
    expect(payload.LineItems).toHaveLength(1);
    expect((payload.LineItems[0] as { TaxType: string }).TaxType).toBe("EXEMPTOUTPUT");
  });
});

describe("allocations", () => {
  it("allocates at most what the invoice still owes", () => {
    expect(allocationAmountCents(110, 550)).toBe(11000);
    expect(allocationAmountCents(110, 40.5)).toBe(4050);
    expect(allocationAmountCents(110, 0)).toBe(0);
    expect(buildAllocationPayload("inv-1", 4050, new Date("2026-10-15T02:00:00Z"))).toEqual({
      Allocations: [{ Invoice: { InvoiceID: "inv-1" }, Amount: 40.5, Date: "2026-10-15" }],
    });
  });
});

describe("payments", () => {
  const payment = {
    amountCents: 27500,
    paidAt: new Date("2026-10-15T03:00:00Z"),
    reference: "EFT 8812",
    methodLabel: "Bank transfer",
    invoiceNumber: "INV-0042",
  };

  it("picks the bank account by id, else by code", () => {
    expect(paymentAccount({ bankAccountId: "acc-1", bankAccountCode: "090" })).toEqual({
      AccountID: "acc-1",
    });
    expect(paymentAccount({ bankAccountId: null, bankAccountCode: "090" })).toEqual({
      Code: "090",
    });
    expect(paymentAccount({ bankAccountId: null, bankAccountCode: null })).toBeNull();
  });

  it("pays the invoice into the bank account", () => {
    expect(buildPaymentPayload(payment, { invoiceId: "inv-1" }, { AccountID: "acc-1" })).toEqual({
      Invoice: { InvoiceID: "inv-1" },
      Account: { AccountID: "acc-1" },
      Date: "2026-10-15",
      Amount: 275,
      Reference: "Bank transfer EFT 8812",
    });
  });

  it("pays a refund out against a credit note with a positive amount", () => {
    expect(
      buildPaymentPayload(
        { ...payment, amountCents: -5000, reference: null },
        { creditNoteId: "cn-1" },
        { Code: "090" },
      ),
    ).toEqual({
      CreditNote: { CreditNoteID: "cn-1" },
      Account: { Code: "090" },
      Date: "2026-10-15",
      Amount: 50,
      Reference: "Refund INV-0042 Bank transfer",
    });
  });
});
