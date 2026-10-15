import type { InvoiceStatus, PaymentTerms } from "@prisma/client";
import { addMelbourneDays, melbourneDaysBetween } from "@/lib/dates";

export const PAYMENT_TERMS_DAYS: Record<PaymentTerms, number> = {
  ON_COMPLETION: 0,
  DAYS_7: 7,
  DAYS_14: 14,
  DAYS_30: 30,
};

export function dueDateFromTerms(issueDate: Date, terms: PaymentTerms): Date {
  return addMelbourneDays(issueDate, PAYMENT_TERMS_DAYS[terms]);
}

export interface InvoiceStatusInput {
  status: InvoiceStatus;
  totalCents: number;
  amountPaidCents: number;
  creditedCents?: number;
  dueDate: Date;
}

export function invoiceBalance(
  input: Pick<InvoiceStatusInput, "totalCents" | "amountPaidCents" | "creditedCents">,
): number {
  return input.totalCents - input.amountPaidCents - (input.creditedCents ?? 0);
}

/** Whole Melbourne days past the due date (0 when not yet overdue). */
export function daysOverdue(dueDate: Date, now: Date = new Date()): number {
  return Math.max(0, melbourneDaysBetween(dueDate, now));
}

/**
 * Derive an invoice's status from money and dates. VOID is terminal. A DRAFT stays
 * a draft until it is sent or money is received. Paid in full → PAID. Past the due
 * date with a balance → OVERDUE. Some money in → PARTIALLY_PAID. Otherwise SENT.
 */
export function deriveInvoiceStatus(
  input: InvoiceStatusInput,
  now: Date = new Date(),
): InvoiceStatus {
  if (input.status === "VOID") return "VOID";
  const balance = invoiceBalance(input);
  const hasPayments = input.amountPaidCents > 0 || (input.creditedCents ?? 0) > 0;
  if (input.status === "DRAFT" && !hasPayments) return "DRAFT";
  if (balance <= 0 && input.totalCents > 0) return "PAID";
  if (balance <= 0 && input.totalCents === 0 && hasPayments) return "PAID";
  if (daysOverdue(input.dueDate, now) > 0) return "OVERDUE";
  if (input.amountPaidCents > 0) return "PARTIALLY_PAID";
  return "SENT";
}

/** Overdue reminder emails go out once each at 1, 7 and 14 days overdue. */
export const OVERDUE_REMINDER_DAYS = [1, 7, 14] as const;

/** Reminder stages that are due now and have not been sent yet. */
export function dueOverdueReminderStages(overdueDays: number, alreadySent: number[]): number[] {
  return OVERDUE_REMINDER_DAYS.filter((d) => overdueDays >= d && !alreadySent.includes(d));
}

/** Aged receivables buckets: current (not yet due), 1-30, 31-60, 61-90 and 90+ days overdue. */
export const AGE_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export function ageBucket(dueDate: Date, now: Date = new Date()): AgeBucket {
  const days = daysOverdue(dueDate, now);
  if (days === 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}
