import "server-only";
import type { ReminderChannel, ReminderType, EntityType } from "@prisma/client";
import { db } from "@/lib/db";
import { addMelbourneDays, formatDate, startOfMelbourneDay, toDateInput } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { appUrl, formatAddress } from "@/lib/utils";
import { daysOverdue, deriveInvoiceStatus, dueOverdueReminderStages } from "@/lib/invoice-status";
import { renderTemplate, sendEmail } from "@/lib/email";
import { resolveTemplates } from "@/lib/email/templates";
import InvoiceOverdueEmail from "@/emails/invoice-overdue";
import ServiceDueReminderEmail from "@/emails/service-due-reminder";
import { logActivity, notifyRoles, notifyUsers } from "@/server/audit";
import { getSettings } from "@/server/settings";
import { bankDetailsLines, recalcInvoice } from "@/server/invoices/service";

/**
 * Claim a reminder slot. The unique `key` makes each reminder fire at most once even
 * if the cron runs twice or overlaps. Returns false when it was already claimed.
 */
async function claim(
  key: string,
  type: ReminderType,
  entityType: EntityType,
  entityId: string,
  channel: ReminderChannel = "EMAIL",
) {
  try {
    await db.reminder.create({
      data: { key, type, entityType, entityId, channel, dueAt: new Date(), status: "PENDING" },
    });
    return true;
  } catch {
    return false;
  }
}

async function finish(key: string, ok: boolean) {
  await db.reminder.update({
    where: { key },
    data: { status: ok ? "SENT" : "FAILED", sentAt: ok ? new Date() : null },
  });
}

export interface CronSummary {
  invoicesUpdated: number;
  overdueEmails: number;
  serviceReminders: number;
  licenceAlerts: number;
  warrantyAlerts: number;
  quotesExpired: number;
  errors: string[];
}

/** Daily run (8am Melbourne): overdue invoices, service due, licence & warranty expiry, quote expiry. */
export async function runDailyReminders(now = new Date()): Promise<CronSummary> {
  const summary: CronSummary = {
    invoicesUpdated: 0,
    overdueEmails: 0,
    serviceReminders: 0,
    licenceAlerts: 0,
    warrantyAlerts: 0,
    quotesExpired: 0,
    errors: [],
  };
  const settings = await getSettings();
  const templates = resolveTemplates(settings.emailTemplates);
  const today = startOfMelbourneDay(now);

  // 1. Invoice statuses + overdue reminders at 1, 7 and 14 days (each once).
  const open = await db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      balanceCents: { gt: 0 },
    },
    include: { client: true },
  });
  for (const invoice of open) {
    try {
      const status = deriveInvoiceStatus(invoice, now);
      if (status !== invoice.status) {
        await db.$transaction(async (tx) => {
          await recalcInvoice(tx, invoice.id, now);
          if (status === "OVERDUE") {
            await logActivity(tx, {
              entityType: "INVOICE",
              entityId: invoice.id,
              type: "STATUS_CHANGE",
              body: "Invoice is now overdue",
            });
            await notifyRoles(tx, ["ADMIN", "OFFICE"], {
              title: `${invoice.number} is overdue`,
              body: `${invoice.client.name} · ${formatCents(invoice.balanceCents)}`,
              link: `/invoices/${invoice.id}`,
            });
          }
        });
        summary.invoicesUpdated += 1;
      }
      if (status !== "OVERDUE" || !invoice.client.email) continue;
      const overdue = daysOverdue(invoice.dueDate, now);
      const sent = await db.reminder.findMany({
        where: { entityId: invoice.id, type: "INVOICE_OVERDUE" },
        select: { key: true },
      });
      const sentStages = sent.map((r) => Number(r.key.split(":").pop()));
      const due = dueOverdueReminderStages(overdue, sentStages);
      if (due.length === 0) continue;
      // If runs were missed, send only the latest stage and mark earlier ones as skipped.
      const stage = due[due.length - 1];
      for (const skipped of due.slice(0, -1)) {
        if (
          await claim(
            `INVOICE_OVERDUE:${invoice.id}:${skipped}`,
            "INVOICE_OVERDUE",
            "INVOICE",
            invoice.id,
          )
        ) {
          await db.reminder.update({
            where: { key: `INVOICE_OVERDUE:${invoice.id}:${skipped}` },
            data: { status: "CANCELLED" },
          });
        }
      }
      const key = `INVOICE_OVERDUE:${invoice.id}:${stage}`;
      if (!(await claim(key, "INVOICE_OVERDUE", "INVOICE", invoice.id))) continue;
      const vars = {
        clientName: invoice.client.name.split(" ")[0],
        number: invoice.number,
        balance: formatCents(invoice.balanceCents),
        dueDate: formatDate(invoice.dueDate),
        daysOverdue: overdue,
        businessName: settings.businessName,
      };
      const result = await sendEmail({
        to: invoice.client.email,
        subject: renderTemplate(templates.invoiceOverdue.subject, vars),
        replyTo: settings.email ?? undefined,
        react: InvoiceOverdueEmail({
          business: settings,
          clientName: vars.clientName,
          invoiceNumber: invoice.number,
          balance: vars.balance,
          dueDate: vars.dueDate,
          daysOverdue: overdue,
          link: appUrl(`/i/${invoice.publicToken}`),
          bankDetails: bankDetailsLines(settings).join("\n") || null,
          body: renderTemplate(templates.invoiceOverdue.body, vars),
        }),
      });
      await finish(key, result.ok);
      if (result.ok) {
        summary.overdueEmails += 1;
        await logActivity(db, {
          entityType: "INVOICE",
          entityId: invoice.id,
          type: "EMAIL",
          body: `Overdue reminder (${stage} day${stage > 1 ? "s" : ""}) emailed to ${invoice.client.email}`,
        });
      } else summary.errors.push(`${invoice.number}: ${result.error}`);
    } catch (error) {
      summary.errors.push(
        `${invoice.number}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 2. Service due in the next 14 days (one reminder per plan per due date).
  const plans = await db.maintenancePlan.findMany({
    where: {
      active: true,
      nextDueDate: { gte: today, lte: addMelbourneDays(today, 14) },
      client: { deletedAt: null, doNotService: false },
    },
    include: { client: true, property: true },
  });
  for (const plan of plans) {
    const key = `SERVICE_DUE:${plan.id}:${toDateInput(plan.nextDueDate)}`;
    if (!(await claim(key, "SERVICE_DUE", "MAINTENANCE_PLAN", plan.id))) continue;
    try {
      let ok = true;
      if (plan.client.email) {
        const vars = {
          clientName: plan.client.name.split(" ")[0],
          planName: plan.name,
          dueDate: formatDate(plan.nextDueDate),
          businessName: settings.businessName,
        };
        const result = await sendEmail({
          to: plan.client.email,
          subject: renderTemplate(templates.serviceDue.subject, vars),
          replyTo: settings.email ?? undefined,
          react: ServiceDueReminderEmail({
            business: settings,
            clientName: vars.clientName,
            planName: plan.name,
            dueDate: vars.dueDate,
            address: plan.property ? formatAddress(plan.property) : null,
            body: renderTemplate(templates.serviceDue.body, vars),
          }),
        });
        ok = result.ok;
        if (!ok) summary.errors.push(`Plan ${plan.id}: ${result.error}`);
      }
      await finish(key, ok);
      await notifyRoles(db, ["ADMIN", "OFFICE"], {
        title: `Service due ${formatDate(plan.nextDueDate)}: ${plan.client.name}`,
        body: `${plan.name}${plan.client.email ? " · reminder emailed" : " · no email, give them a call"}`,
        link: "/maintenance",
      });
      await logActivity(db, {
        entityType: "CLIENT",
        entityId: plan.clientId,
        type: plan.client.email ? "EMAIL" : "SYSTEM",
        body: `Service reminder for “${plan.name}” (due ${formatDate(plan.nextDueDate)})`,
      });
      summary.serviceReminders += 1;
    } catch (error) {
      summary.errors.push(
        `Plan ${plan.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 3. Technician licences expiring within 30 days (or already expired).
  const licences = await db.technicianLicence.findMany({
    where: { expiresAt: { lte: addMelbourneDays(today, 30) }, user: { active: true } },
    include: { user: true },
  });
  for (const l of licences) {
    const key = `LICENCE_EXPIRY:${l.id}:${toDateInput(l.expiresAt)}`;
    if (!(await claim(key, "LICENCE_EXPIRY", "LICENCE", l.id, "IN_APP"))) continue;
    const expired = l.expiresAt! < now;
    const notification = {
      title: `${l.user.name}'s licence ${expired ? "has expired" : `expires ${formatDate(l.expiresAt)}`}`,
      body: `${l.type.replace(/_/g, " ").toLowerCase()} · ${l.number}`,
      link: `/team/${l.userId}`,
    };
    await notifyRoles(db, ["ADMIN"], notification);
    if (l.user.role !== "ADMIN")
      await notifyUsers(db, [l.userId], { ...notification, link: "/account" });
    await finish(key, true);
    summary.licenceAlerts += 1;
  }

  // 4. Equipment warranties expiring within 30 days: a chance to sell a service plan.
  const warranties = await db.equipment.findMany({
    where: { warrantyExpiresAt: { gte: today, lte: addMelbourneDays(today, 30) } },
    include: { property: { include: { client: { select: { name: true, deletedAt: true } } } } },
  });
  for (const e of warranties) {
    if (e.property.client.deletedAt) continue;
    const key = `WARRANTY_EXPIRY:${e.id}:${toDateInput(e.warrantyExpiresAt)}`;
    if (!(await claim(key, "WARRANTY_EXPIRY", "EQUIPMENT", e.id, "IN_APP"))) continue;
    await notifyRoles(db, ["ADMIN", "OFFICE"], {
      title: `Warranty ends ${formatDate(e.warrantyExpiresAt)}: ${e.brand} ${e.model ?? ""}`.trim(),
      body: `${e.property.client.name} · offer a maintenance plan`,
      link: `/equipment/${e.id}`,
    });
    await finish(key, true);
    summary.warrantyAlerts += 1;
  }

  // 5. Expire quotes past their valid-until date.
  const stale = await db.quote.findMany({
    where: { deletedAt: null, status: { in: ["SENT", "VIEWED"] }, validUntil: { lt: today } },
    select: { id: true },
  });
  for (const q of stale) {
    await db.$transaction(async (tx) => {
      await tx.quote.update({ where: { id: q.id }, data: { status: "EXPIRED" } });
      await logActivity(tx, {
        entityType: "QUOTE",
        entityId: q.id,
        type: "STATUS_CHANGE",
        body: "Quote expired",
      });
    });
    summary.quotesExpired += 1;
  }

  return summary;
}
