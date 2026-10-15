"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/numbering";
import { addMelbourneDays, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { appUrl } from "@/lib/utils";
import { sendEmail, renderTemplate } from "@/lib/email";
import { resolveTemplates } from "@/lib/email/templates";
import QuoteSentEmail from "@/emails/quote-sent";
import { acceptQuoteSchema, quoteDecisionSchema, quoteSchema } from "@/lib/validations/quotes";
import {
  NotFoundError,
  UserError,
  idSchema,
  runAction,
  toErrorResult,
  type ActionResult,
} from "@/server/action";
import { audit, logActivity, notifyRoles } from "@/server/audit";
import { getSettings } from "@/server/settings";
import { writeQuoteOptions } from "./service";

function revalidateQuote(id?: string) {
  revalidatePath("/quotes");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/quotes/${id}`);
}

export async function createQuote(input: z.input<typeof quoteSchema>) {
  return runAction(
    { schema: quoteSchema, permission: ["create", "quotes"] },
    input,
    async (d, user) => {
      const settings = await getSettings();
      const quote = await db.$transaction(async (tx) => {
        const client = await tx.client.findFirst({ where: { id: d.clientId, deletedAt: null } });
        if (!client) throw new NotFoundError("Client");
        const number = await nextDocumentNumber(tx, "QUOTE");
        const created = await tx.quote.create({
          data: {
            number,
            clientId: d.clientId,
            propertyId: d.propertyId,
            leadId: d.leadId,
            title: d.title,
            intro: d.intro,
            terms: d.terms ?? settings.quoteTerms,
            validUntil: d.validUntil ?? addMelbourneDays(new Date(), settings.quoteValidityDays),
          },
        });
        const { totals } = await writeQuoteOptions(
          tx,
          created.id,
          d.options,
          settings.gstRegistered,
        );
        await tx.quote.update({ where: { id: created.id }, data: totals });
        if (d.leadId) {
          const lead = await tx.lead.findUnique({ where: { id: d.leadId } });
          if (lead && ["NEW", "CONTACTED", "SITE_VISIT_BOOKED"].includes(lead.status)) {
            await tx.lead.update({
              where: { id: lead.id },
              data: { status: "QUOTED", clientId: lead.clientId ?? d.clientId },
            });
            await logActivity(tx, {
              entityType: "LEAD",
              entityId: lead.id,
              type: "STATUS_CHANGE",
              body: `Quoted (${number})`,
              userId: user.id,
            });
          }
        }
        await logActivity(tx, {
          entityType: "QUOTE",
          entityId: created.id,
          body: `Quote ${number} created`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "QUOTE",
          entityId: created.id,
          changes: { number, ...totals },
        });
        return created;
      });
      revalidateQuote();
      return { id: quote.id };
    },
  );
}

export async function updateQuote(id: string, input: z.input<typeof quoteSchema>) {
  return runAction(
    { schema: quoteSchema, permission: ["update", "quotes"] },
    input,
    async (d, user) => {
      const settings = await getSettings();
      await db.$transaction(async (tx) => {
        const before = await tx.quote.findFirst({ where: { id, deletedAt: null } });
        if (!before) throw new NotFoundError("Quote");
        if (before.status === "ACCEPTED" || before.status === "DECLINED") {
          throw new UserError("Accepted or declined quotes can't be edited. Duplicate it instead.");
        }
        const { totals } = await writeQuoteOptions(tx, id, d.options, settings.gstRegistered);
        await tx.quote.update({
          where: { id },
          data: {
            clientId: d.clientId,
            propertyId: d.propertyId,
            leadId: d.leadId,
            title: d.title,
            intro: d.intro,
            terms: d.terms,
            validUntil: d.validUntil,
            selectedOptionId: null,
            status: before.status === "EXPIRED" ? "DRAFT" : before.status,
            ...totals,
          },
        });
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "QUOTE",
          entityId: id,
          changes: {
            totalCents: { from: before.totalCents, to: totals.totalCents },
            options: d.options.length,
          },
        });
        await logActivity(tx, {
          entityType: "QUOTE",
          entityId: id,
          body: "Quote edited",
          userId: user.id,
        });
      });
      revalidateQuote(id);
      return { id };
    },
  );
}

export async function sendQuote(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "quotes"] },
    input,
    async ({ id }, user) => {
      const quote = await db.quote.findFirst({
        where: { id, deletedAt: null },
        include: { client: true },
      });
      if (!quote) throw new NotFoundError("Quote");
      if (!quote.client.email)
        throw new UserError("This client has no email address. Add one to send the quote.");
      if (quote.status === "ACCEPTED" || quote.status === "DECLINED")
        throw new UserError("This quote has already been decided.");
      const settings = await getSettings();
      const templates = resolveTemplates(settings.emailTemplates);
      const vars = {
        clientName: quote.client.name.split(" ")[0],
        number: quote.number,
        title: quote.title,
        total: formatCents(quote.totalCents),
        businessName: settings.businessName,
      };
      const link = appUrl(`/q/${quote.publicToken}`);
      const result = await sendEmail({
        to: quote.client.email,
        subject: renderTemplate(templates.quoteSent.subject, vars),
        replyTo: settings.email ?? undefined,
        react: QuoteSentEmail({
          business: settings,
          clientName: vars.clientName,
          quoteNumber: quote.number,
          title: quote.title,
          total: vars.total,
          validUntil: quote.validUntil ? formatDate(quote.validUntil) : undefined,
          link,
          body: renderTemplate(templates.quoteSent.body, vars),
        }),
      });
      if (!result.ok) throw new UserError(`Email failed: ${result.error ?? "unknown error"}`);
      await db.$transaction(async (tx) => {
        await tx.quote.update({
          where: { id },
          data: { status: quote.status === "VIEWED" ? "VIEWED" : "SENT", sentAt: new Date() },
        });
        await logActivity(tx, {
          entityType: "QUOTE",
          entityId: id,
          type: "EMAIL",
          body: `Quote emailed to ${quote.client.email}${result.skipped ? " (email not configured, logged only)" : ""}`,
          userId: user.id,
        });
        await audit(tx, { userId: user.id, action: "SEND", entityType: "QUOTE", entityId: id });
      });
      revalidateQuote(id);
      return { link, skipped: !!result.skipped };
    },
  );
}

/** Office records that the client accepted (by phone / in person). */
export async function acceptQuote(input: z.input<typeof acceptQuoteSchema>) {
  return runAction(
    { schema: acceptQuoteSchema, permission: ["update", "quotes"] },
    input,
    async ({ id, optionId }, user) => {
      await db.$transaction((tx) =>
        applyAcceptance(tx, id, optionId, user.id, "Accepted (recorded by office)"),
      );
      revalidateQuote(id);
      return { id };
    },
  );
}

export async function declineQuote(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "quotes"] },
    input,
    async ({ id }, user) => {
      await db.$transaction(async (tx) => {
        const quote = await tx.quote.update({
          where: { id },
          data: { status: "DECLINED", declinedAt: new Date() },
        });
        await logActivity(tx, {
          entityType: "QUOTE",
          entityId: id,
          type: "STATUS_CHANGE",
          body: "Declined (recorded by office)",
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "STATUS",
          entityType: "QUOTE",
          entityId: id,
          changes: { status: "DECLINED" },
        });
        if (quote.leadId) {
          await tx.lead.updateMany({
            where: { id: quote.leadId, status: { notIn: ["WON", "LOST"] } },
            data: { status: "LOST", lostReason: "Quote declined" },
          });
        }
      });
      revalidateQuote(id);
      return { id };
    },
  );
}

export async function duplicateQuote(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["create", "quotes"] },
    input,
    async ({ id }, user) => {
      const settings = await getSettings();
      const source = await db.quote.findFirst({
        where: { id, deletedAt: null },
        include: { options: { include: { lineItems: true }, orderBy: { sortOrder: "asc" } } },
      });
      if (!source) throw new NotFoundError("Quote");
      const copy = await db.$transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, "QUOTE");
        const created = await tx.quote.create({
          data: {
            number,
            clientId: source.clientId,
            propertyId: source.propertyId,
            leadId: source.leadId,
            title: source.title,
            intro: source.intro,
            terms: source.terms,
            validUntil: addMelbourneDays(new Date(), settings.quoteValidityDays),
          },
        });
        const { totals } = await writeQuoteOptions(
          tx,
          created.id,
          source.options.map((o) => ({
            name: o.name,
            description: o.description,
            lines: o.lineItems
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((l) => ({
                priceBookItemId: l.priceBookItemId,
                description: l.description,
                quantity: Number(l.quantity),
                unitPrice: l.unitPriceCents,
                taxable: l.taxable,
              })),
          })),
          settings.gstRegistered,
        );
        await tx.quote.update({ where: { id: created.id }, data: totals });
        await logActivity(tx, {
          entityType: "QUOTE",
          entityId: created.id,
          body: `Duplicated from ${source.number}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "QUOTE",
          entityId: created.id,
          changes: { duplicatedFrom: source.number },
        });
        return created;
      });
      revalidateQuote();
      return { id: copy.id };
    },
  );
}

export async function deleteQuote(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "quotes"] },
    input,
    async ({ id }, user) => {
      const jobs = await db.job.count({ where: { quoteId: id, deletedAt: null } });
      if (jobs > 0) throw new UserError("A job was created from this quote. Delete the job first.");
      await db.$transaction(async (tx) => {
        await tx.quote.update({ where: { id }, data: { deletedAt: new Date() } });
        await audit(tx, { userId: user.id, action: "DELETE", entityType: "QUOTE", entityId: id });
      });
      revalidateQuote();
      return null;
    },
  );
}

/** Create a job from an accepted quote, copying the chosen option's lines into job line items. */
export async function createJobFromQuote(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["create", "jobs"] },
    input,
    async ({ id }, user) => {
      const quote = await db.quote.findFirst({
        where: { id, deletedAt: null },
        include: {
          options: {
            include: {
              lineItems: { include: { priceBookItem: true }, orderBy: { sortOrder: "asc" } },
            },
            orderBy: { sortOrder: "asc" },
          },
          lead: true,
        },
      });
      if (!quote) throw new NotFoundError("Quote");
      if (quote.status !== "ACCEPTED") throw new UserError("Only accepted quotes can become jobs.");
      const option = quote.options.find((o) => o.id === quote.selectedOptionId) ?? quote.options[0];
      if (!option) throw new UserError("This quote has no options.");
      const job = await db.$transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, "JOB");
        const isInstall = option.lineItems.some((l) => l.priceBookItem?.type === "EQUIPMENT");
        const created = await tx.job.create({
          data: {
            number,
            clientId: quote.clientId,
            propertyId: quote.propertyId,
            quoteId: quote.id,
            type: isInstall ? "INSTALLATION" : "REPAIR",
            serviceCategory:
              quote.lead?.serviceCategory ??
              option.lineItems.find((l) => l.priceBookItem)?.priceBookItem?.category ??
              null,
            title: quote.options.length > 1 ? `${quote.title} (${option.name})` : quote.title,
            description: [quote.intro, option.description].filter(Boolean).join("\n\n") || null,
            lineItems: {
              create: option.lineItems.map((l, i) => ({
                priceBookItemId: l.priceBookItemId,
                type: l.priceBookItem?.type ?? "OTHER",
                description: l.description,
                quantity: l.quantity,
                unitPriceCents: l.unitPriceCents,
                unitCostCents: l.priceBookItem?.costCents ?? 0,
                taxable: l.taxable,
                sortOrder: i,
              })),
            },
          },
        });
        await logActivity(tx, {
          entityType: "JOB",
          entityId: created.id,
          body: `Job created from quote ${quote.number}`,
          userId: user.id,
        });
        await logActivity(tx, {
          entityType: "QUOTE",
          entityId: quote.id,
          body: `Job ${number} created`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "JOB",
          entityId: created.id,
          changes: { fromQuote: quote.number },
        });
        return created;
      });
      revalidateQuote(id);
      revalidatePath("/jobs");
      return { id: job.id };
    },
  );
}

// ─── Shared acceptance logic (office + public page) ─────────────────────────

async function applyAcceptance(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  quoteId: string,
  optionId: string,
  userId: string | null,
  note: string,
) {
  const quote = await tx.quote.findFirst({
    where: { id: quoteId, deletedAt: null },
    include: { options: true, client: true },
  });
  if (!quote) throw new NotFoundError("Quote");
  if (quote.status === "ACCEPTED") throw new UserError("This quote has already been accepted.");
  if (quote.status === "DECLINED") throw new UserError("This quote was declined.");
  const option = quote.options.find((o) => o.id === optionId);
  if (!option) throw new UserError("Choose one of the quoted options.");
  await tx.quote.update({
    where: { id: quoteId },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
      selectedOptionId: option.id,
      subtotalCents: option.subtotalCents,
      gstCents: option.gstCents,
      totalCents: option.totalCents,
    },
  });
  await logActivity(tx, {
    entityType: "QUOTE",
    entityId: quoteId,
    type: "STATUS_CHANGE",
    body: `${note}: ${option.name} (${formatCents(option.totalCents)})`,
    userId,
  });
  await audit(tx, {
    userId,
    action: "ACCEPT",
    entityType: "QUOTE",
    entityId: quoteId,
    changes: { optionId },
  });
  if (quote.leadId) {
    await tx.lead.updateMany({
      where: { id: quote.leadId, status: { not: "WON" } },
      data: { status: "WON" },
    });
    await logActivity(tx, {
      entityType: "LEAD",
      entityId: quote.leadId,
      type: "STATUS_CHANGE",
      body: `Won: quote ${quote.number} accepted`,
      userId,
    });
  }
  await notifyRoles(tx, ["ADMIN", "OFFICE"], {
    title: `Quote ${quote.number} accepted`,
    body: `${quote.client.name} chose ${option.name} (${formatCents(option.totalCents)})`,
    link: `/quotes/${quoteId}`,
  });
}

// ─── Public quote page actions (no login; authorised by the unguessable token) ─

export async function acceptQuoteByToken(
  input: z.input<typeof quoteDecisionSchema>,
): Promise<ActionResult<null>> {
  const parsed = quoteDecisionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.optionId)
    return { ok: false, error: "Choose an option to accept." };
  if (!parsed.data.signedName) return { ok: false, error: "Type your name to accept." };
  const { token, optionId, signedName } = parsed.data;
  try {
    const quote = await db.quote.findFirst({ where: { publicToken: token, deletedAt: null } });
    if (!quote) return { ok: false, error: "Quote not found." };
    if (
      quote.validUntil &&
      quote.validUntil < addMelbourneDays(new Date(), -1) &&
      quote.status !== "ACCEPTED"
    ) {
      return {
        ok: false,
        error: "This quote has expired. Please contact us for an updated quote.",
      };
    }
    await db.$transaction((tx) =>
      applyAcceptance(tx, quote.id, optionId, null, `Accepted online by ${signedName}`),
    );
    revalidateQuote(quote.id);
    revalidatePath(`/q/${token}`);
    return { ok: true, data: null };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function declineQuoteByToken(
  input: z.input<typeof quoteDecisionSchema>,
): Promise<ActionResult<null>> {
  const parsed = quoteDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { token, reason } = parsed.data;
  try {
    const quote = await db.quote.findFirst({
      where: { publicToken: token, deletedAt: null },
      include: { client: true },
    });
    if (!quote) return { ok: false, error: "Quote not found." };
    if (quote.status === "ACCEPTED" || quote.status === "DECLINED")
      return { ok: false, error: "This quote has already been decided." };
    await db.$transaction(async (tx) => {
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: "DECLINED", declinedAt: new Date() },
      });
      await logActivity(tx, {
        entityType: "QUOTE",
        entityId: quote.id,
        type: "STATUS_CHANGE",
        body: `Declined online${reason ? `: ${reason}` : ""}`,
      });
      await audit(tx, {
        userId: null,
        action: "DECLINE",
        entityType: "QUOTE",
        entityId: quote.id,
        changes: { reason },
      });
      if (quote.leadId) {
        await tx.lead.updateMany({
          where: { id: quote.leadId, status: { notIn: ["WON", "LOST"] } },
          data: {
            status: "LOST",
            lostReason: reason ? `Quote declined: ${reason}`.slice(0, 200) : "Quote declined",
          },
        });
      }
      await notifyRoles(tx, ["ADMIN", "OFFICE"], {
        title: `Quote ${quote.number} declined`,
        body: `${quote.client.name}${reason ? `: ${reason}` : ""}`,
        link: `/quotes/${quote.id}`,
      });
    });
    revalidateQuote(quote.id);
    revalidatePath(`/q/${token}`);
    return { ok: true, data: null };
  } catch (error) {
    return toErrorResult(error);
  }
}
