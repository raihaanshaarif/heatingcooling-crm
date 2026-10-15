"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { paymentSchema } from "@/lib/validations/invoices";
import { NotFoundError, UserError, idSchema, runAction } from "@/server/action";
import { audit, logActivity } from "@/server/audit";
import { recalcInvoice } from "@/server/invoices/service";

function revalidatePayments(invoiceId: string, clientId: string) {
  revalidatePath("/payments");
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  revalidatePath("/reports");
}

/** Record a payment (or a refund) against an invoice and update its balance and status. */
export async function recordPayment(input: z.input<typeof paymentSchema>) {
  return runAction(
    { schema: paymentSchema, permission: ["create", "payments"] },
    input,
    async (d, user) => {
      const invoice = await db.invoice.findFirst({ where: { id: d.invoiceId, deletedAt: null } });
      if (!invoice) throw new NotFoundError("Invoice");
      if (invoice.status === "VOID")
        throw new UserError("You can't record payments on a void invoice.");
      if (d.isRefund && d.amount > invoice.amountPaidCents)
        throw new UserError(`You can refund at most ${formatCents(invoice.amountPaidCents)}.`);
      if (!d.isRefund && d.amount > invoice.balanceCents)
        throw new UserError(
          `That's more than the balance of ${formatCents(invoice.balanceCents)}. Record the overpayment as a separate credit.`,
        );
      const amountCents = d.isRefund ? -d.amount : d.amount;
      const payment = await db.$transaction(async (tx) => {
        const created = await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            clientId: invoice.clientId,
            amountCents,
            method: d.method,
            reference: d.reference,
            paidAt: d.paidAt,
            notes: d.notes,
            recordedById: user.id,
          },
        });
        // Recording a payment on a draft means it was handed over: it is no longer a draft.
        if (invoice.status === "DRAFT")
          await tx.invoice.update({ where: { id: invoice.id }, data: { status: "SENT" } });
        const updated = await recalcInvoice(tx, invoice.id);
        await logActivity(tx, {
          entityType: "INVOICE",
          entityId: invoice.id,
          type: "SYSTEM",
          body: `${d.isRefund ? "Refund" : "Payment"} of ${formatCents(d.amount)} by ${PAYMENT_METHOD_LABELS[d.method]}${d.reference ? ` (${d.reference})` : ""}. Balance ${formatCents(updated.balanceCents)}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "PAYMENT",
          entityId: created.id,
          changes: { invoiceId: invoice.id, amountCents, method: d.method },
        });
        return created;
      });
      revalidatePayments(invoice.id, invoice.clientId);
      return { id: payment.id };
    },
  );
}

export async function deletePayment(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "payments"] },
    input,
    async ({ id }, user) => {
      const payment = await db.payment.findUnique({ where: { id } });
      if (!payment) throw new NotFoundError("Payment");
      if (payment.stripePaymentIntentId)
        throw new UserError("Card payments from Stripe must be refunded in Stripe.");
      await db.$transaction(async (tx) => {
        await tx.payment.delete({ where: { id } });
        await recalcInvoice(tx, payment.invoiceId);
        await logActivity(tx, {
          entityType: "INVOICE",
          entityId: payment.invoiceId,
          type: "SYSTEM",
          body: `Payment of ${formatCents(payment.amountCents)} removed`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "DELETE",
          entityType: "PAYMENT",
          entityId: id,
          changes: { amountCents: payment.amountCents },
        });
      });
      revalidatePayments(payment.invoiceId, payment.clientId);
      return null;
    },
  );
}
