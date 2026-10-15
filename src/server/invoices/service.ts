import "server-only";
import type { Tx } from "@/lib/db";
import { calculateTotals, lineTotalCents } from "@/lib/money";
import { deriveInvoiceStatus, invoiceBalance } from "@/lib/invoice-status";
import type { BusinessSettingsRecord } from "@/server/settings";

export interface InvoiceLineData {
  description: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number;
  taxable: boolean;
}

/** Replace an invoice's lines and return the new totals (GST on the taxable sum). */
export async function writeInvoiceLines(
  tx: Tx,
  invoiceId: string,
  lines: InvoiceLineData[],
  gstRegistered: boolean,
) {
  await tx.invoiceLineItem.deleteMany({ where: { invoiceId } });
  await tx.invoiceLineItem.createMany({
    data: lines.map((l, i) => ({
      invoiceId,
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPrice,
      unitCostCents: l.unitCost ?? 0,
      taxable: l.taxable,
      totalCents: lineTotalCents(l.quantity, l.unitPrice),
      sortOrder: i,
    })),
  });
  return calculateTotals(
    lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPrice, taxable: l.taxable })),
    gstRegistered,
  );
}

/**
 * Recalculate paid / credited / balance from payments and credit notes, then derive
 * the status. Call after anything that changes money on an invoice.
 */
export async function recalcInvoice(tx: Tx, id: string, now = new Date()) {
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });
  const [paid, credited, lastPayment] = await Promise.all([
    tx.payment.aggregate({ where: { invoiceId: id }, _sum: { amountCents: true } }),
    tx.creditNote.aggregate({ where: { invoiceId: id }, _sum: { amountCents: true } }),
    tx.payment.findFirst({
      where: { invoiceId: id, amountCents: { gt: 0 } },
      orderBy: { paidAt: "desc" },
    }),
  ]);
  const amountPaidCents = paid._sum.amountCents ?? 0;
  const creditedCents = credited._sum.amountCents ?? 0;
  const money = { totalCents: invoice.totalCents, amountPaidCents, creditedCents };
  const status = deriveInvoiceStatus(
    { ...money, status: invoice.status, dueDate: invoice.dueDate },
    now,
  );
  const balanceCents = status === "VOID" ? 0 : invoiceBalance(money);
  return tx.invoice.update({
    where: { id },
    data: {
      amountPaidCents,
      creditedCents,
      balanceCents,
      status,
      paidAt: status === "PAID" ? (invoice.paidAt ?? lastPayment?.paidAt ?? now) : null,
    },
  });
}

export function bankDetailsLines(settings: BusinessSettingsRecord): string[] {
  return [
    settings.accountName ? `Account name: ${settings.accountName}` : null,
    settings.bankName ? `Bank: ${settings.bankName}` : null,
    settings.bsb ? `BSB: ${settings.bsb}` : null,
    settings.accountNumber ? `Account: ${settings.accountNumber}` : null,
  ].filter((l): l is string => !!l);
}
