import "server-only";
import { db } from "@/lib/db";

export async function listPayments(range: { from?: Date | null; to?: Date | null } = {}) {
  const payments = await db.payment.findMany({
    where: {
      paidAt: { gte: range.from ?? undefined, lt: range.to ?? undefined },
      invoice: { deletedAt: null },
    },
    include: {
      invoice: { select: { id: true, number: true } },
      client: { select: { id: true, name: true } },
      recordedBy: { select: { name: true } },
    },
    orderBy: { paidAt: "desc" },
  });
  return payments.map((p) => ({
    id: p.id,
    invoiceId: p.invoice.id,
    invoiceNumber: p.invoice.number,
    clientId: p.client.id,
    clientName: p.client.name,
    amountCents: p.amountCents,
    method: p.method,
    reference: p.reference,
    paidAt: p.paidAt,
    recordedBy: p.recordedBy?.name ?? null,
  }));
}
export type PaymentRow = Awaited<ReturnType<typeof listPayments>>[number];
