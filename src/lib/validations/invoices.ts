import { z } from "zod";
import { PaymentMethod, PaymentTerms } from "@prisma/client";
import {
  money,
  optionalDate,
  optionalId,
  optionalText,
  quantity,
  requiredDate,
  requiredMoney,
  requiredText,
} from "./common";

export const invoiceLineSchema = z.object({
  description: requiredText("Description", 1000),
  quantity,
  unitPrice: money("Unit price"),
  unitCost: money("Unit cost").optional(),
  taxable: z.boolean().default(true),
});
export type InvoiceLineInput = z.input<typeof invoiceLineSchema>;

export const invoiceSchema = z.object({
  clientId: z.string().min(1, "Choose a client"),
  propertyId: optionalId,
  jobId: optionalId,
  issueDate: requiredDate("Issue date"),
  paymentTerms: z.nativeEnum(PaymentTerms),
  dueDate: optionalDate,
  notes: optionalText(5000),
  lines: z.array(invoiceLineSchema).min(1, "Add at least one line item"),
});
export type InvoiceInput = z.input<typeof invoiceSchema>;

export const invoiceFromJobSchema = z.object({
  jobId: z.string().min(1),
  kind: z.enum(["full", "deposit", "progress"]).default("full"),
  percent: z.coerce.number().min(1).max(100).default(100),
});

export const voidInvoiceSchema = z.object({
  id: z.string().min(1),
  reason: requiredText("Reason", 500),
});

export const creditNoteSchema = z.object({
  invoiceId: z.string().min(1),
  amount: requiredMoney("Credit amount"),
  reason: requiredText("Reason", 1000),
});
export type CreditNoteInput = z.input<typeof creditNoteSchema>;

export const paymentSchema = z.object({
  invoiceId: z.string().min(1, "Choose an invoice"),
  amount: requiredMoney("Amount"),
  method: z.nativeEnum(PaymentMethod),
  reference: optionalText(200),
  paidAt: requiredDate("Payment date"),
  notes: optionalText(2000),
  isRefund: z.boolean().default(false),
});
export type PaymentInput = z.input<typeof paymentSchema>;
