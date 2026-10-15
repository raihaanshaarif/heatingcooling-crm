import "server-only";
import { after } from "next/server";
import type { Prisma, XeroJobKind } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { canMergeJobs } from "@/lib/xero/queue";
import { CONNECTION_ID } from "./connection";

type Client = Tx | typeof db;

export interface EnqueueInput {
  kind: XeroJobKind;
  entityId: string;
  invoiceId?: string | null;
  label: string;
  payload?: Prisma.InputJsonValue;
}

async function markRecordPending(client: Client, kind: XeroJobKind, entityId: string) {
  const data = { xeroSyncStatus: "PENDING" as const, xeroSyncError: null };
  if (kind === "INVOICE" || kind === "VOID_INVOICE")
    await client.invoice.updateMany({ where: { id: entityId }, data });
  else if (kind === "CONTACT") await client.client.updateMany({ where: { id: entityId }, data });
  else if (kind === "CREDIT_NOTE")
    await client.creditNote.updateMany({ where: { id: entityId }, data });
  else if (kind === "PAYMENT") await client.payment.updateMany({ where: { id: entityId }, data });
}

/**
 * Add a job to the Xero outbox, normally inside the transaction that made the change so
 * the job exists exactly when the change does. Does nothing (returns false) unless Xero is
 * connected to an organisation: nothing piles up while it isn't set up.
 */
export async function enqueueXeroJob(client: Client, input: EnqueueInput): Promise<boolean> {
  const conn = await client.xeroConnection.findUnique({
    where: { id: CONNECTION_ID },
    select: { tenantId: true },
  });
  if (!conn?.tenantId) return false;
  const reset = {
    status: "PENDING" as const,
    attempts: 0,
    nextAttemptAt: new Date(),
    lastError: null,
    completedAt: null,
    label: input.label,
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  };
  const existing = canMergeJobs(input.kind)
    ? await client.xeroSyncJob.findFirst({
        where: {
          kind: input.kind,
          entityId: input.entityId,
          status: { in: ["PENDING", "FAILED"] },
        },
        orderBy: { createdAt: "asc" },
      })
    : null;
  if (existing) await client.xeroSyncJob.update({ where: { id: existing.id }, data: reset });
  else
    await client.xeroSyncJob.create({
      data: { ...reset, kind: input.kind, entityId: input.entityId, invoiceId: input.invoiceId },
    });
  await markRecordPending(client, input.kind, input.entityId);
  return true;
}

async function cancelJobs(client: Client, kind: XeroJobKind, entityId: string, reason: string) {
  await client.xeroSyncJob.updateMany({
    where: { kind, entityId, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "CANCELLED", lastError: reason, completedAt: new Date() },
  });
}

// ─── Triggers used by the invoice / payment / client actions ─────────────────

export function queueInvoiceSync(client: Client, invoice: { id: string; number: string }) {
  return enqueueXeroJob(client, {
    kind: "INVOICE",
    entityId: invoice.id,
    invoiceId: invoice.id,
    label: invoice.number,
  });
}

/** Always queued (even if not pushed yet): the worker looks it up by number in case it was. */
export async function queueInvoiceVoid(client: Client, invoice: { id: string; number: string }) {
  await cancelJobs(client, "INVOICE", invoice.id, "Invoice was voided");
  return enqueueXeroJob(client, {
    kind: "VOID_INVOICE",
    entityId: invoice.id,
    invoiceId: invoice.id,
    label: `Void ${invoice.number}`,
  });
}

export function queueCreditNoteSync(
  client: Client,
  note: { id: string; number: string; amountCents: number },
  invoice: { id: string; number: string },
) {
  return enqueueXeroJob(client, {
    kind: "CREDIT_NOTE",
    entityId: note.id,
    invoiceId: invoice.id,
    label: `${note.number} ${formatCents(note.amountCents)} on ${invoice.number}`,
  });
}

export function queuePaymentSync(
  client: Client,
  payment: { id: string; amountCents: number },
  invoice: { id: string; number: string },
) {
  return enqueueXeroJob(client, {
    kind: "PAYMENT",
    entityId: payment.id,
    invoiceId: invoice.id,
    label: `${payment.amountCents < 0 ? "Refund" : "Payment"} ${formatCents(Math.abs(payment.amountCents))} on ${invoice.number}`,
  });
}

/**
 * The payment row is about to be deleted, so the Xero PaymentID travels in the payload.
 * Never pushed → cancel the waiting push instead (a push already running notices the row
 * is gone and deletes what it created).
 */
export async function queuePaymentDelete(
  client: Client,
  payment: { id: string; amountCents: number; xeroPaymentId: string | null },
  invoice: { id: string; number: string },
) {
  await cancelJobs(client, "PAYMENT", payment.id, "Payment was deleted before it was synced");
  if (!payment.xeroPaymentId) return false;
  return enqueueXeroJob(client, {
    kind: "DELETE_PAYMENT",
    entityId: payment.id,
    invoiceId: invoice.id,
    label: `Delete ${payment.amountCents < 0 ? "refund" : "payment"} ${formatCents(Math.abs(payment.amountCents))} on ${invoice.number}`,
    payload: { xeroPaymentId: payment.xeroPaymentId },
  });
}

/** Client details changed: only pushed when the client is already linked to a Xero contact. */
export function queueContactUpdate(
  client: Client,
  record: { id: string; name: string; xeroContactId: string | null },
) {
  if (!record.xeroContactId) return Promise.resolve(false);
  return enqueueXeroJob(client, { kind: "CONTACT", entityId: record.id, label: record.name });
}

/**
 * Process the queue after the response has been sent (non-blocking), when automatic sync
 * is on. Safe to call when Xero isn't connected: the run returns straight away.
 */
export function kickXeroSync() {
  try {
    after(async () => {
      try {
        const { runAutomaticXeroSync } = await import("./sync");
        await runAutomaticXeroSync();
      } catch (error) {
        console.error("[xero] background sync failed", error);
      }
    });
  } catch {
    // Outside a request (scripts, tests): the cron or Sync now will pick the jobs up.
  }
}
