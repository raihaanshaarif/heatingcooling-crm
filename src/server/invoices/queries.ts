import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { deriveInvoiceStatus } from "@/lib/invoice-status";
import { getTimeline } from "@/server/activity/queries";

/** Status is stored, but re-derived on read so an invoice shows overdue the day after it falls due. */
function liveStatus<
  T extends {
    status: Prisma.InvoiceGetPayload<object>["status"];
    totalCents: number;
    amountPaidCents: number;
    creditedCents: number;
    dueDate: Date;
  },
>(i: T) {
  return deriveInvoiceStatus(i);
}

export async function listInvoices() {
  const invoices = await db.invoice.findMany({
    where: { deletedAt: null },
    include: {
      client: { select: { id: true, name: true } },
      job: { select: { id: true, number: true } },
    },
    orderBy: [{ issueDate: "desc" }, { number: "desc" }],
  });
  return invoices.map((i) => ({
    id: i.id,
    number: i.number,
    clientId: i.client.id,
    clientName: i.client.name,
    jobId: i.job?.id ?? null,
    jobNumber: i.job?.number ?? null,
    status: liveStatus(i),
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    totalCents: i.totalCents,
    amountPaidCents: i.amountPaidCents,
    balanceCents: i.balanceCents,
  }));
}
export type InvoiceRow = Awaited<ReturnType<typeof listInvoices>>[number];

const invoiceInclude = {
  client: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
  property: true,
  job: { select: { id: true, number: true, title: true, quoteId: true } },
  lineItems: { orderBy: { sortOrder: "asc" } },
  payments: { orderBy: { paidAt: "asc" }, include: { recordedBy: { select: { name: true } } } },
  creditNotes: { orderBy: { issuedAt: "asc" } },
} satisfies Prisma.InvoiceInclude;

function serialise(invoice: Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>) {
  return {
    ...invoice,
    status: liveStatus(invoice),
    lineItems: invoice.lineItems.map((l) => ({ ...l, quantity: toNumber(l.quantity) ?? 0 })),
  };
}

export async function getInvoice(id: string) {
  const invoice = await db.invoice.findFirst({
    where: { id, deletedAt: null },
    include: invoiceInclude,
  });
  if (!invoice) return null;
  const timeline = await getTimeline([
    { entityType: "INVOICE", ids: [id] },
    { entityType: "PAYMENT", ids: invoice.payments.map((p) => p.id) },
  ]);
  return { ...serialise(invoice), timeline };
}
export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

export async function getInvoiceByToken(token: string) {
  const invoice = await db.invoice.findFirst({
    where: { publicToken: token, deletedAt: null, status: { not: "DRAFT" } },
    include: invoiceInclude,
  });
  return invoice ? serialise(invoice) : null;
}

/** Invoices that can take a payment (for the "Record payment" picker). */
export async function getOpenInvoiceOptions() {
  const invoices = await db.invoice.findMany({
    where: { deletedAt: null, status: { notIn: ["VOID", "PAID", "DRAFT"] } },
    include: { client: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
  });
  return invoices.map((i) => ({
    value: i.id,
    label: `${i.number} · ${i.client.name}`,
    balanceCents: i.balanceCents,
  }));
}
