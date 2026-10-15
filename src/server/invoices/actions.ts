"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/numbering";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { appUrl } from "@/lib/utils";
import { dueDateFromTerms, daysOverdue } from "@/lib/invoice-status";
import { renderTemplate, sendEmail } from "@/lib/email";
import { resolveTemplates } from "@/lib/email/templates";
import InvoiceSentEmail from "@/emails/invoice-sent";
import {
  creditNoteSchema,
  invoiceFromJobSchema,
  invoiceSchema,
  voidInvoiceSchema,
} from "@/lib/validations/invoices";
import { NotFoundError, UserError, idSchema, runAction } from "@/server/action";
import { audit, diff, logActivity } from "@/server/audit";
import { getSettings } from "@/server/settings";
import {
  bankDetailsLines,
  recalcInvoice,
  writeInvoiceLines,
  type InvoiceLineData,
} from "./service";

function revalidateInvoice(id?: string, jobId?: string | null, clientId?: string) {
  revalidatePath("/invoices");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  if (id) revalidatePath(`/invoices/${id}`);
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

/** Moving a job back out of INVOICED when its invoice goes away. */
async function releaseJob(tx: Tx, jobId: string | null) {
  if (!jobId) return;
  const remaining = await tx.invoice.count({
    where: { jobId, deletedAt: null, status: { not: "VOID" } },
  });
  if (remaining === 0)
    await tx.job.updateMany({
      where: { id: jobId, status: "INVOICED" },
      data: { status: "COMPLETED" },
    });
}

export async function createInvoice(input: z.input<typeof invoiceSchema>) {
  return runAction(
    { schema: invoiceSchema, permission: ["create", "invoices"] },
    input,
    async (d, user) => {
      const settings = await getSettings();
      const invoice = await db.$transaction(async (tx) => {
        const client = await tx.client.findFirst({ where: { id: d.clientId, deletedAt: null } });
        if (!client) throw new NotFoundError("Client");
        const number = await nextDocumentNumber(tx, "INVOICE");
        const created = await tx.invoice.create({
          data: {
            number,
            clientId: d.clientId,
            propertyId: d.propertyId,
            jobId: d.jobId,
            issueDate: d.issueDate,
            paymentTerms: d.paymentTerms,
            dueDate: d.dueDate ?? dueDateFromTerms(d.issueDate, d.paymentTerms),
            notes: d.notes,
          },
        });
        const totals = await writeInvoiceLines(tx, created.id, d.lines, settings.gstRegistered);
        await tx.invoice.update({
          where: { id: created.id },
          data: { ...totals, balanceCents: totals.totalCents },
        });
        await logActivity(tx, {
          entityType: "INVOICE",
          entityId: created.id,
          body: `Invoice ${number} created`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "INVOICE",
          entityId: created.id,
          changes: { number, ...totals },
        });
        return created;
      });
      revalidateInvoice(invoice.id, invoice.jobId, invoice.clientId);
      return { id: invoice.id };
    },
  );
}

export async function updateInvoice(id: string, input: z.input<typeof invoiceSchema>) {
  return runAction(
    { schema: invoiceSchema, permission: ["update", "invoices"] },
    input,
    async (d, user) => {
      const settings = await getSettings();
      const before = await db.invoice.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundError("Invoice");
      if (before.status === "VOID") throw new UserError("Void invoices can't be edited.");
      if (before.amountPaidCents !== 0 || before.creditedCents !== 0)
        throw new UserError(
          "This invoice has payments or credits. Issue a credit note instead of editing it.",
        );
      await db.$transaction(async (tx) => {
        const data = {
          clientId: d.clientId,
          propertyId: d.propertyId,
          issueDate: d.issueDate,
          paymentTerms: d.paymentTerms,
          dueDate: d.dueDate ?? dueDateFromTerms(d.issueDate, d.paymentTerms),
          notes: d.notes,
        };
        await tx.invoice.update({ where: { id }, data });
        const totals = await writeInvoiceLines(tx, id, d.lines, settings.gstRegistered);
        await tx.invoice.update({ where: { id }, data: totals });
        await recalcInvoice(tx, id);
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "INVOICE",
          entityId: id,
          changes: diff(
            { ...before, totalCents: before.totalCents },
            { ...data, totalCents: totals.totalCents },
          ),
        });
      });
      revalidateInvoice(id, before.jobId, before.clientId);
      return { id };
    },
  );
}

/** Create an invoice from a job: the full job, or a deposit / progress claim as a % of it. */
export async function createInvoiceFromJob(input: z.input<typeof invoiceFromJobSchema>) {
  return runAction(
    { schema: invoiceFromJobSchema, permission: ["create", "invoices"] },
    input,
    async ({ jobId, kind, percent }, user) => {
      const settings = await getSettings();
      const invoice = await db.$transaction(async (tx) => {
        const job = await tx.job.findFirst({
          where: { id: jobId, deletedAt: null },
          include: {
            lineItems: { orderBy: { sortOrder: "asc" } },
            quote: {
              include: {
                options: {
                  include: { lineItems: { orderBy: { sortOrder: "asc" } } },
                  orderBy: { sortOrder: "asc" },
                },
              },
            },
            invoices: {
              where: { deletedAt: null, status: { not: "VOID" } },
              orderBy: { createdAt: "asc" },
            },
          },
        });
        if (!job) throw new NotFoundError("Job");
        if (job.status === "INVOICED")
          throw new UserError("This job has already been invoiced in full.");
        if (job.status === "CANCELLED") throw new UserError("Cancelled jobs can't be invoiced.");

        let source: InvoiceLineData[] = job.lineItems.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: l.unitPriceCents,
          unitCost: l.unitCostCents,
          taxable: l.taxable,
        }));
        if (source.length === 0 && job.quote) {
          const option =
            job.quote.options.find((o) => o.id === job.quote?.selectedOptionId) ??
            job.quote.options[0];
          source = (option?.lineItems ?? []).map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: l.unitPriceCents,
            taxable: l.taxable,
          }));
        }
        if (source.length === 0)
          throw new UserError(
            "Add labour or parts to the job (or link an accepted quote) before invoicing.",
          );

        let lines: InvoiceLineData[];
        if (kind === "full") {
          lines = [...source];
          for (const prior of job.invoices) {
            lines.push({
              description: `Less ${prior.number} (invoiced previously)`,
              quantity: 1,
              unitPrice: -prior.subtotalCents,
              taxable: prior.gstCents > 0,
            });
          }
        } else {
          const base = source.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPrice), 0);
          const label = kind === "deposit" ? "Deposit" : "Progress claim";
          lines = [
            {
              description: `${label} (${percent}%): ${job.number} ${job.title}`,
              quantity: 1,
              unitPrice: Math.round((base * percent) / 100),
              taxable: true,
            },
          ];
        }

        const issueDate = new Date();
        const terms = kind === "deposit" ? "ON_COMPLETION" : settings.defaultPaymentTerms;
        const number = await nextDocumentNumber(tx, "INVOICE");
        const created = await tx.invoice.create({
          data: {
            number,
            clientId: job.clientId,
            propertyId: job.propertyId,
            jobId: job.id,
            issueDate,
            paymentTerms: terms,
            dueDate: dueDateFromTerms(issueDate, terms),
          },
        });
        const totals = await writeInvoiceLines(tx, created.id, lines, settings.gstRegistered);
        await tx.invoice.update({
          where: { id: created.id },
          data: { ...totals, balanceCents: totals.totalCents },
        });
        if (kind === "full")
          await tx.job.update({ where: { id: job.id }, data: { status: "INVOICED" } });
        await logActivity(tx, {
          entityType: "INVOICE",
          entityId: created.id,
          body: `Invoice ${number} created from ${job.number}`,
          userId: user.id,
        });
        await logActivity(tx, {
          entityType: "JOB",
          entityId: job.id,
          body: `${kind === "full" ? "Invoiced" : kind === "deposit" ? "Deposit invoiced" : "Progress claim invoiced"}: ${number}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "INVOICE",
          entityId: created.id,
          changes: { number, jobId, kind, percent, ...totals },
        });
        return created;
      });
      revalidateInvoice(invoice.id, jobId, invoice.clientId);
      return { id: invoice.id };
    },
  );
}

export async function sendInvoice(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "invoices"] },
    input,
    async ({ id }, user) => {
      const invoice = await db.invoice.findFirst({
        where: { id, deletedAt: null },
        include: { client: true },
      });
      if (!invoice) throw new NotFoundError("Invoice");
      if (invoice.status === "VOID") throw new UserError("Void invoices can't be sent.");
      if (!invoice.client.email)
        throw new UserError("This client has no email address. Add one to send the invoice.");
      const settings = await getSettings();
      const templates = resolveTemplates(settings.emailTemplates);
      const link = appUrl(`/i/${invoice.publicToken}`);
      const vars = {
        clientName: invoice.client.name.split(" ")[0],
        number: invoice.number,
        total: formatCents(invoice.totalCents),
        balance: formatCents(invoice.balanceCents),
        dueDate: formatDate(invoice.dueDate),
        daysOverdue: daysOverdue(invoice.dueDate),
        businessName: settings.businessName,
      };
      const result = await sendEmail({
        to: invoice.client.email,
        subject: renderTemplate(templates.invoiceSent.subject, vars),
        replyTo: settings.email ?? undefined,
        react: InvoiceSentEmail({
          business: settings,
          clientName: vars.clientName,
          invoiceNumber: invoice.number,
          total: vars.total,
          balance: vars.balance,
          dueDate: vars.dueDate,
          link,
          bankDetails: bankDetailsLines(settings).join("\n") || null,
          body: renderTemplate(templates.invoiceSent.body, vars),
        }),
      });
      if (!result.ok) throw new UserError(`Email failed: ${result.error ?? "unknown error"}`);
      await db.$transaction(async (tx) => {
        await tx.invoice.update({
          where: { id },
          data: {
            status: invoice.status === "DRAFT" ? "SENT" : invoice.status,
            sentAt: new Date(),
          },
        });
        await recalcInvoice(tx, id);
        await logActivity(tx, {
          entityType: "INVOICE",
          entityId: id,
          type: "EMAIL",
          body: `Invoice emailed to ${invoice.client.email}${result.skipped ? " (email not configured, logged only)" : ""}`,
          userId: user.id,
        });
        await audit(tx, { userId: user.id, action: "SEND", entityType: "INVOICE", entityId: id });
      });
      revalidateInvoice(id, invoice.jobId, invoice.clientId);
      return { link, skipped: !!result.skipped };
    },
  );
}

/** For invoices handed over in person or sent from another system. */
export async function markInvoiceSent(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "invoices"] },
    input,
    async ({ id }, user) => {
      const invoice = await db.invoice.findFirst({ where: { id, deletedAt: null } });
      if (!invoice) throw new NotFoundError("Invoice");
      if (invoice.status !== "DRAFT") throw new UserError("Only drafts can be marked as sent.");
      await db.$transaction(async (tx) => {
        await tx.invoice.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
        await recalcInvoice(tx, id);
        await logActivity(tx, {
          entityType: "INVOICE",
          entityId: id,
          body: "Marked as sent",
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "STATUS",
          entityType: "INVOICE",
          entityId: id,
          changes: { status: { from: "DRAFT", to: "SENT" } },
        });
      });
      revalidateInvoice(id, invoice.jobId, invoice.clientId);
      return { id };
    },
  );
}

export async function voidInvoice(input: z.input<typeof voidInvoiceSchema>) {
  return runAction(
    { schema: voidInvoiceSchema, permission: ["update", "invoices"] },
    input,
    async ({ id, reason }, user) => {
      const invoice = await db.invoice.findFirst({ where: { id, deletedAt: null } });
      if (!invoice) throw new NotFoundError("Invoice");
      if (invoice.status === "VOID") throw new UserError("This invoice is already void.");
      if (invoice.amountPaidCents !== 0)
        throw new UserError("Refund or remove the payments on this invoice before voiding it.");
      await db.$transaction(async (tx) => {
        await tx.invoice.update({
          where: { id },
          data: { status: "VOID", voidedAt: new Date(), balanceCents: 0 },
        });
        await releaseJob(tx, invoice.jobId);
        await logActivity(tx, {
          entityType: "INVOICE",
          entityId: id,
          type: "STATUS_CHANGE",
          body: `Voided: ${reason}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "VOID",
          entityType: "INVOICE",
          entityId: id,
          changes: { reason },
        });
      });
      revalidateInvoice(id, invoice.jobId, invoice.clientId);
      return { id };
    },
  );
}

export async function deleteInvoice(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "invoices"] },
    input,
    async ({ id }, user) => {
      const invoice = await db.invoice.findFirst({ where: { id, deletedAt: null } });
      if (!invoice) throw new NotFoundError("Invoice");
      if (invoice.status !== "DRAFT")
        throw new UserError("Only draft invoices can be deleted. Void it instead.");
      await db.$transaction(async (tx) => {
        await tx.invoice.update({ where: { id }, data: { deletedAt: new Date() } });
        await releaseJob(tx, invoice.jobId);
        await audit(tx, { userId: user.id, action: "DELETE", entityType: "INVOICE", entityId: id });
      });
      revalidateInvoice(undefined, invoice.jobId, invoice.clientId);
      return null;
    },
  );
}

export async function createCreditNote(input: z.input<typeof creditNoteSchema>) {
  return runAction(
    { schema: creditNoteSchema, permission: ["update", "invoices"] },
    input,
    async ({ invoiceId, amount, reason }, user) => {
      const invoice = await db.invoice.findFirst({ where: { id: invoiceId, deletedAt: null } });
      if (!invoice) throw new NotFoundError("Invoice");
      if (invoice.status === "VOID" || invoice.status === "DRAFT")
        throw new UserError("Credit notes can only be issued against sent invoices.");
      if (amount > invoice.totalCents - invoice.creditedCents)
        throw new UserError(
          `You can credit at most ${formatCents(invoice.totalCents - invoice.creditedCents)} on this invoice.`,
        );
      const note = await db.$transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, "CREDIT_NOTE");
        const created = await tx.creditNote.create({
          data: { number, invoiceId, amountCents: amount, reason },
        });
        await recalcInvoice(tx, invoiceId);
        await logActivity(tx, {
          entityType: "INVOICE",
          entityId: invoiceId,
          body: `Credit note ${number} for ${formatCents(amount)}: ${reason}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "CREDIT_NOTE",
          entityId: created.id,
          changes: { number, invoiceId, amount, reason },
        });
        return created;
      });
      revalidateInvoice(invoiceId, invoice.jobId, invoice.clientId);
      return { id: note.id, number: note.number };
    },
  );
}
