import "server-only";
import { createHash } from "node:crypto";
import type { XeroSyncJob } from "@prisma/client";
import { db } from "@/lib/db";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { XeroApiError, XeroRateLimitError, type XeroApi } from "@/lib/xero/client";
import { TokenDecryptError } from "@/lib/xero/crypto";
import { XeroAuthError } from "@/lib/xero/oauth";
import {
  XERO_DEAD_STATUSES,
  allocationAmountCents,
  buildAllocationPayload,
  buildContactPayload,
  buildCreditNotePayload,
  buildInvoicePayload,
  buildPaymentPayload,
  firstOf,
  listOf,
  matchContact,
  paymentAccount,
  whereString,
  type XeroContactSummary,
} from "@/lib/xero/payloads";
import { STALE_LOCK_MS, nextStateAfterFailure, type SyncFailure } from "@/lib/xero/queue";
import type { XeroSettings } from "@/lib/validations/settings";
import { getSettings } from "@/server/settings";
import {
  CONNECTION_ID,
  getAccessToken,
  getXeroApi,
  getXeroConnection,
  getXeroSettings,
} from "./connection";

/** A problem found before / instead of calling Xero (missing mapping, nothing to refund against…). */
export class XeroSyncError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "XeroSyncError";
  }
}

interface Ctx {
  api: XeroApi;
  settings: XeroSettings;
  gstRegistered: boolean;
}

interface XeroInvoice {
  InvoiceID: string;
  Status: string;
  Type?: string;
  AmountDue?: number;
  AmountPaid?: number;
  AmountCredited?: number;
}
interface XeroCreditNote {
  CreditNoteID: string;
  Status: string;
  RemainingCredit?: number;
}

const synced = () => ({
  xeroSyncStatus: "SYNCED" as const,
  xeroSyncError: null,
  xeroSyncedAt: new Date(),
});

/** Stable per-request key: a retry of the same create can never make a duplicate in Xero. */
function idempotencyKey(prefix: string, id: string, payload: unknown) {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
  return `coolops-${prefix}-${id}-${hash}`;
}

// ─── Contacts ────────────────────────────────────────────────────────────────

async function findContact(ctx: Ctx, client: { id: string; name: string; email: string | null }) {
  const terms = [client.email, client.name].filter((t): t is string => !!t);
  for (const searchTerm of terms) {
    const res = await ctx.api.get("/Contacts", { searchTerm, page: "1" });
    const match = matchContact(listOf<XeroContactSummary>(res, "Contacts"), client);
    if (match) return match.ContactID;
  }
  return null;
}

/** The client's Xero ContactID: stored, else matched by email / name, else created. */
export async function ensureContact(ctx: Ctx, clientId: string): Promise<string> {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  if (client.xeroContactId) return client.xeroContactId;
  let contactId = await findContact(ctx, client);
  if (!contactId) {
    const payload = buildContactPayload(client);
    const res = await ctx.api.post(
      "/Contacts",
      { Contacts: [payload] },
      { idempotencyKey: idempotencyKey("contact", client.id, payload) },
    );
    contactId = firstOf<{ ContactID: string }>(res, "Contacts")?.ContactID ?? null;
    if (!contactId) throw new XeroSyncError("Xero didn't return the new contact.", true);
  }
  await db.client.update({
    where: { id: clientId },
    data: { xeroContactId: contactId, ...synced() },
  });
  return contactId;
}

async function syncContactJob(ctx: Ctx, clientId: string) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client || client.deletedAt) return "Client was deleted; nothing to update";
  if (!client.xeroContactId) {
    await ensureContact(ctx, clientId);
    return null;
  }
  await ctx.api.post("/Contacts", {
    Contacts: [buildContactPayload(client, client.xeroContactId)],
  });
  await db.client.update({ where: { id: clientId }, data: synced() });
  return null;
}

// ─── Invoices ────────────────────────────────────────────────────────────────

async function findXeroInvoice(ctx: Ctx, xeroId: string | null, number: string) {
  if (xeroId) return firstOf<XeroInvoice>(await ctx.api.get(`/Invoices/${xeroId}`), "Invoices");
  const res = await ctx.api.get("/Invoices", { InvoiceNumbers: number });
  const all = listOf<XeroInvoice>(res, "Invoices").filter((i) => (i.Type ?? "ACCREC") === "ACCREC");
  return all.find((i) => !XERO_DEAD_STATUSES.includes(i.Status)) ?? null;
}

/** Create or update the invoice in Xero. Returns its InvoiceID. */
export async function syncInvoice(ctx: Ctx, invoiceId: string): Promise<string> {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      job: { select: { number: true } },
    },
  });
  if (!inv || inv.deletedAt) throw new XeroSyncError("The invoice was deleted.");
  if (inv.status === "DRAFT")
    throw new XeroSyncError(
      "Draft invoices aren't sent to Xero. Send it or mark it as sent first.",
    );
  if (inv.status === "VOID") throw new XeroSyncError("The invoice is void in CoolOps.");

  const existing = await findXeroInvoice(ctx, inv.xeroInvoiceId, inv.number);
  if (existing && XERO_DEAD_STATUSES.includes(existing.Status))
    throw new XeroSyncError(
      `This invoice is ${existing.Status.toLowerCase()} in Xero, so it can't be updated.`,
    );
  let xeroId = existing?.InvoiceID ?? null;
  const locked =
    existing &&
    (existing.Status === "PAID" ||
      (existing.AmountPaid ?? 0) > 0 ||
      (existing.AmountCredited ?? 0) > 0);
  if (!locked) {
    const contactId = await ensureContact(ctx, inv.clientId);
    const payload = buildInvoicePayload(
      {
        number: inv.number,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        jobNumber: inv.job?.number,
        gstCents: inv.gstCents,
        lineItems: inv.lineItems.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPriceCents: l.unitPriceCents,
          totalCents: l.totalCents,
          taxable: l.taxable,
        })),
      },
      {
        contactId,
        xeroInvoiceId: xeroId,
        // Xero can't move an approved invoice back to draft.
        status: existing?.Status === "AUTHORISED" ? "AUTHORISED" : ctx.settings.invoiceStatus,
        mapping: ctx.settings,
        gstRegistered: ctx.gstRegistered,
      },
    );
    const res = await ctx.api.post(
      "/Invoices",
      { Invoices: [payload] },
      xeroId ? {} : { idempotencyKey: idempotencyKey("invoice", inv.id, payload) },
    );
    xeroId = firstOf<XeroInvoice>(res, "Invoices")?.InvoiceID ?? xeroId;
    if (!xeroId) throw new XeroSyncError("Xero didn't return the invoice.", true);
  }
  await db.invoice.update({ where: { id: inv.id }, data: { xeroInvoiceId: xeroId, ...synced() } });
  return xeroId!;
}

async function ensureInvoice(ctx: Ctx, invoiceId: string) {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { xeroInvoiceId: true },
  });
  if (inv?.xeroInvoiceId) return inv.xeroInvoiceId;
  try {
    return await syncInvoice(ctx, invoiceId);
  } catch (error) {
    if (
      error instanceof XeroRateLimitError ||
      error instanceof XeroAuthError ||
      error instanceof TokenDecryptError
    )
      throw error;
    const message = error instanceof Error ? error.message : String(error);
    const retryable =
      error instanceof XeroApiError || error instanceof XeroSyncError ? error.retryable : true;
    throw new XeroSyncError(`The invoice isn't in Xero yet: ${message}`, retryable);
  }
}

async function voidInvoiceJob(ctx: Ctx, invoiceId: string) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return "Invoice no longer exists";
  if (inv.status !== "VOID") return "Invoice is no longer void in CoolOps; nothing to do";
  const existing = await findXeroInvoice(ctx, inv.xeroInvoiceId, inv.number);
  if (!existing) {
    await db.invoice.update({
      where: { id: inv.id },
      data: { xeroSyncStatus: null, xeroSyncError: null },
    });
    return "Never sent to Xero; nothing to void";
  }
  if (!XERO_DEAD_STATUSES.includes(existing.Status)) {
    if ((existing.AmountPaid ?? 0) > 0 || (existing.AmountCredited ?? 0) > 0)
      throw new XeroSyncError(
        "Xero has payments or credit notes on this invoice. Remove them in Xero, then click Retry.",
      );
    const status = ["DRAFT", "SUBMITTED"].includes(existing.Status) ? "DELETED" : "VOIDED";
    await ctx.api.post(`/Invoices/${existing.InvoiceID}`, {
      Invoices: [{ InvoiceID: existing.InvoiceID, Status: status }],
    });
  }
  await db.invoice.update({
    where: { id: inv.id },
    data: { xeroInvoiceId: existing.InvoiceID, ...synced() },
  });
  return null;
}

// ─── Credit notes ────────────────────────────────────────────────────────────

async function creditNoteJob(ctx: Ctx, creditNoteId: string) {
  const note = await db.creditNote.findUnique({
    where: { id: creditNoteId },
    include: { invoice: { include: { lineItems: true } } },
  });
  if (!note) return "Credit note no longer exists";
  const invoiceXeroId = await ensureInvoice(ctx, note.invoiceId);
  const contactId = await ensureContact(ctx, note.invoice.clientId);

  let xeroNote: XeroCreditNote | null = null;
  if (note.xeroCreditNoteId) {
    xeroNote = firstOf<XeroCreditNote>(
      await ctx.api.get(`/CreditNotes/${note.xeroCreditNoteId}`),
      "CreditNotes",
    );
  } else {
    const res = await ctx.api.get("/CreditNotes", {
      where: `CreditNoteNumber==${whereString(note.number)}`,
    });
    xeroNote =
      listOf<XeroCreditNote>(res, "CreditNotes").find(
        (c) => !XERO_DEAD_STATUSES.includes(c.Status),
      ) ?? null;
  }
  if (!xeroNote) {
    const payload = buildCreditNotePayload(
      {
        number: note.number,
        issuedAt: note.issuedAt,
        reason: note.reason,
        amountCents: note.amountCents,
        invoice: {
          number: note.invoice.number,
          totalCents: note.invoice.totalCents,
          gstCents: note.invoice.gstCents,
          taxableCents: note.invoice.lineItems
            .filter((l) => l.taxable)
            .reduce((s, l) => s + l.totalCents, 0),
        },
      },
      {
        contactId,
        status: ctx.settings.invoiceStatus,
        mapping: ctx.settings,
        gstRegistered: ctx.gstRegistered,
      },
    );
    const res = await ctx.api.post(
      "/CreditNotes",
      { CreditNotes: [payload] },
      { idempotencyKey: idempotencyKey("credit", note.id, payload) },
    );
    xeroNote = firstOf<XeroCreditNote>(res, "CreditNotes");
    if (!xeroNote) throw new XeroSyncError("Xero didn't return the credit note.", true);
  }
  await db.creditNote.update({
    where: { id: note.id },
    data: { xeroCreditNoteId: xeroNote.CreditNoteID, ...synced() },
  });

  if (xeroNote.Status !== "AUTHORISED")
    return "Credit note is a draft in Xero: approve and allocate it there";
  const xeroInvoice = await findXeroInvoice(ctx, invoiceXeroId, note.invoice.number);
  const amount = allocationAmountCents(xeroNote.RemainingCredit ?? 0, xeroInvoice?.AmountDue ?? 0);
  if (amount > 0) {
    await ctx.api.put(
      `/CreditNotes/${xeroNote.CreditNoteID}/Allocations`,
      buildAllocationPayload(invoiceXeroId, amount, note.issuedAt),
    );
  }
  return null;
}

// ─── Payments ────────────────────────────────────────────────────────────────

async function deleteXeroPayment(ctx: Ctx, xeroPaymentId: string) {
  const existing = firstOf<{ Status: string }>(
    await ctx.api.get(`/Payments/${xeroPaymentId}`),
    "Payments",
  );
  if (!existing || existing.Status === "DELETED") return "Already deleted in Xero";
  await ctx.api.post(`/Payments/${xeroPaymentId}`, { Payments: [{ Status: "DELETED" }] });
  return null;
}

async function paymentJob(ctx: Ctx, paymentId: string) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: { include: { creditNotes: { orderBy: { issuedAt: "asc" } } } } },
  });
  if (!payment) return "Payment was deleted; nothing to send";
  if (payment.xeroPaymentId) return "Already in Xero";
  const account = paymentAccount(ctx.settings);
  if (!account)
    throw new XeroSyncError(
      "Choose the bank account for payments under Settings → Xero, then click Retry.",
    );
  const invoiceXeroId = await ensureInvoice(ctx, payment.invoiceId);

  let target: { invoiceId: string } | { creditNoteId: string } = { invoiceId: invoiceXeroId };
  if (payment.amountCents < 0) {
    // Refund: Xero pays money out against a credit note with enough credit left.
    let found: string | null = null;
    for (const note of payment.invoice.creditNotes) {
      if (!note.xeroCreditNoteId) continue;
      const xeroNote = firstOf<XeroCreditNote>(
        await ctx.api.get(`/CreditNotes/${note.xeroCreditNoteId}`),
        "CreditNotes",
      );
      if (
        xeroNote?.Status === "AUTHORISED" &&
        Math.round((xeroNote.RemainingCredit ?? 0) * 100) >= -payment.amountCents
      ) {
        found = note.xeroCreditNoteId;
        break;
      }
    }
    if (!found)
      throw new XeroSyncError(
        "Xero can only refund against a credit note. Issue a credit note for the refunded amount in CoolOps (or record the refund in Xero), then click Retry.",
      );
    target = { creditNoteId: found };
  }
  const payload = buildPaymentPayload(
    {
      amountCents: payment.amountCents,
      paidAt: payment.paidAt,
      reference: payment.reference,
      methodLabel: PAYMENT_METHOD_LABELS[payment.method],
      invoiceNumber: payment.invoice.number,
    },
    target,
    account,
  );
  const res = await ctx.api.put(
    "/Payments",
    { Payments: [payload] },
    { idempotencyKey: idempotencyKey("payment", payment.id, payload) },
  );
  const xeroPaymentId = firstOf<{ PaymentID: string }>(res, "Payments")?.PaymentID;
  if (!xeroPaymentId) throw new XeroSyncError("Xero didn't return the payment.", true);
  const saved = await db.payment.updateMany({
    where: { id: payment.id },
    data: { xeroPaymentId, ...synced() },
  });
  if (saved.count === 0) {
    // Deleted in CoolOps while we were sending it: take it back out of Xero.
    await deleteXeroPayment(ctx, xeroPaymentId);
    return "Payment was deleted while syncing; removed from Xero again";
  }
  return null;
}

async function deletePaymentJob(ctx: Ctx, job: XeroSyncJob) {
  const xeroPaymentId = (job.payload as { xeroPaymentId?: string } | null)?.xeroPaymentId;
  if (!xeroPaymentId) return "Payment was never in Xero";
  return deleteXeroPayment(ctx, xeroPaymentId);
}

// ─── Runner ──────────────────────────────────────────────────────────────────

/** Runs one job. Returns an optional note for the log (e.g. "nothing to do"). */
async function runJob(ctx: Ctx, job: XeroSyncJob): Promise<string | null> {
  switch (job.kind) {
    case "CONTACT":
      return syncContactJob(ctx, job.entityId);
    case "INVOICE": {
      const inv = await db.invoice.findUnique({ where: { id: job.entityId } });
      if (!inv || inv.deletedAt) return "Invoice was deleted";
      if (inv.status === "VOID") return "Invoice was voided";
      await syncInvoice(ctx, job.entityId);
      return null;
    }
    case "VOID_INVOICE":
      return voidInvoiceJob(ctx, job.entityId);
    case "CREDIT_NOTE":
      return creditNoteJob(ctx, job.entityId);
    case "PAYMENT":
      return paymentJob(ctx, job.entityId);
    case "DELETE_PAYMENT":
      return deletePaymentJob(ctx, job);
  }
}

const AUTH_PAUSE_MS = 15 * 60_000;

export function toFailure(error: unknown): SyncFailure {
  if (error instanceof XeroRateLimitError)
    return { message: error.message, retryable: true, retryAfterMs: error.retryAfterMs };
  if (error instanceof XeroApiError) return { message: error.message, retryable: error.retryable };
  if (error instanceof XeroSyncError) return { message: error.message, retryable: error.retryable };
  // Token problems affect every job: pause the queue instead of burning attempts.
  if (error instanceof XeroAuthError || error instanceof TokenDecryptError)
    return { message: error.message, retryable: true, retryAfterMs: AUTH_PAUSE_MS };
  console.error("[xero] unexpected sync error", error);
  return { message: error instanceof Error ? error.message : String(error), retryable: true };
}

async function markRecordFailed(job: XeroSyncJob, message: string) {
  const data = { xeroSyncStatus: "FAILED" as const, xeroSyncError: message.slice(0, 1000) };
  const where = { id: job.entityId };
  if (job.kind === "INVOICE" || job.kind === "VOID_INVOICE")
    await db.invoice.updateMany({ where, data });
  else if (job.kind === "CONTACT") await db.client.updateMany({ where, data });
  else if (job.kind === "CREDIT_NOTE") await db.creditNote.updateMany({ where, data });
  else if (job.kind === "PAYMENT") await db.payment.updateMany({ where, data });
}

export interface SyncRunResult {
  ran: boolean;
  reason?: string;
  processed: number;
  succeeded: number;
  failed: number;
  rateLimited: boolean;
  remaining: number;
}

let running = false;

/**
 * Work through due jobs oldest first, one at a time (Xero allows 60 calls a minute and
 * 5 concurrent per organisation). force=true (Sync now) also runs jobs waiting for a retry.
 */
export async function processXeroQueue({
  maxJobs = 50,
  timeBudgetMs = 45_000,
  force = false,
}: { maxJobs?: number; timeBudgetMs?: number; force?: boolean } = {}): Promise<SyncRunResult> {
  const result: SyncRunResult = {
    ran: false,
    processed: 0,
    succeeded: 0,
    failed: 0,
    rateLimited: false,
    remaining: 0,
  };
  const api = await getXeroApi();
  if (!api) return { ...result, reason: "Xero isn't connected." };
  if (running) return { ...result, reason: "A Xero sync is already running." };
  running = true;
  result.ran = true;
  const started = Date.now();
  try {
    await db.xeroSyncJob.updateMany({
      where: { status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      data: { status: "PENDING", lockedAt: null },
    });
    const [settings, business] = await Promise.all([getXeroSettings(), getSettings()]);
    const ctx: Ctx = { api, settings, gstRegistered: business.gstRegistered };
    const seen: string[] = [];
    while (result.processed < maxJobs && Date.now() - started < timeBudgetMs) {
      const job = await db.xeroSyncJob.findFirst({
        where: {
          status: "PENDING",
          id: { notIn: seen },
          ...(force ? {} : { nextAttemptAt: { lte: new Date() } }),
        },
        orderBy: { createdAt: "asc" },
      });
      if (!job) break;
      seen.push(job.id);
      const claimed = await db.xeroSyncJob.updateMany({
        where: { id: job.id, status: "PENDING" },
        data: { status: "PROCESSING", lockedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      result.processed += 1;
      try {
        const note = await runJob(ctx, job);
        await db.xeroSyncJob.update({
          where: { id: job.id },
          data: {
            status: "DONE",
            attempts: job.attempts + 1,
            lastError: note,
            completedAt: new Date(),
            lockedAt: null,
          },
        });
        result.succeeded += 1;
      } catch (error) {
        const failure = toFailure(error);
        const { stopRun, ...next } = nextStateAfterFailure(job, failure);
        await db.xeroSyncJob.update({
          where: { id: job.id },
          data: { ...next, lastError: next.lastError.slice(0, 2000), lockedAt: null },
        });
        await markRecordFailed(job, failure.message);
        result.failed += 1;
        if (stopRun) {
          result.rateLimited = failure.retryAfterMs !== AUTH_PAUSE_MS;
          break;
        }
      }
    }
    result.remaining = await db.xeroSyncJob.count({ where: { status: "PENDING" } });
    await db.xeroConnection.updateMany({
      where: { id: CONNECTION_ID },
      data: { lastSyncAt: new Date() },
    });
  } finally {
    running = false;
  }
  if (result.processed) console.info("[xero] sync run", result);
  return result;
}

/** After an invoice / payment change, when automatic sync is on. */
export async function runAutomaticXeroSync() {
  const settings = await getXeroSettings();
  if (!settings.autoSync) return null;
  return processXeroQueue({ maxJobs: 25, timeBudgetMs: 30_000 });
}

/**
 * Daily cron: keep the connection alive (Xero refresh tokens expire after 60 days unused)
 * and, with automatic sync on, push whatever is due.
 */
export async function runXeroCron() {
  const conn = await getXeroConnection();
  if (!conn?.tenantId) return { skipped: "not connected" };
  try {
    await getAccessToken(true);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const settings = await getXeroSettings();
  if (!settings.autoSync) return { skipped: "manual sync only" };
  return processXeroQueue({ maxJobs: 200, timeBudgetMs: 25_000 });
}
