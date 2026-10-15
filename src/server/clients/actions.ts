"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { clientSchema, contactSchema, propertySchema } from "@/lib/validations/clients";
import { NotFoundError, UserError, idSchema, runAction } from "@/server/action";
import { audit, diff, logActivity } from "@/server/audit";
import { kickXeroSync, queueContactUpdate } from "@/server/xero/queue";
import { kickCalendarSync, queueCalendarSyncForJobs } from "@/server/google-calendar/queue";

function clientData(d: z.output<typeof clientSchema>) {
  return {
    type: d.type,
    name: d.name,
    companyName: d.companyName,
    abn: d.abn,
    email: d.email,
    phone: d.phone,
    altPhone: d.altPhone,
    billingLine1: d.billingLine1,
    billingLine2: d.billingLine2,
    billingSuburb: d.billingSuburb,
    billingState: d.billingState,
    billingPostcode: d.billingPostcode,
    notes: d.notes,
    tags: [...new Set(d.tags)],
    source: d.source,
    doNotService: d.doNotService || d.tags.includes("Do not service"),
    noSms: d.noSms,
  };
}

export async function createClient(input: z.input<typeof clientSchema>) {
  return runAction(
    { schema: clientSchema, permission: ["create", "clients"] },
    input,
    async (d, user) => {
      const client = await db.$transaction(async (tx) => {
        const created = await tx.client.create({ data: clientData(d) });
        if (d.createPropertyFromBilling && d.billingLine1 && d.billingSuburb && d.billingPostcode) {
          await tx.property.create({
            data: {
              clientId: created.id,
              label: "Home",
              addressLine1: d.billingLine1,
              addressLine2: d.billingLine2,
              suburb: d.billingSuburb,
              state: d.billingState,
              postcode: d.billingPostcode,
            },
          });
        }
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "CLIENT",
          entityId: created.id,
          changes: clientData(d),
        });
        await logActivity(tx, {
          entityType: "CLIENT",
          entityId: created.id,
          body: "Client created",
          userId: user.id,
        });
        return created;
      });
      revalidatePath("/clients");
      return { id: client.id };
    },
  );
}

export async function updateClient(id: string, input: z.input<typeof clientSchema>) {
  return runAction(
    { schema: clientSchema, permission: ["update", "clients"] },
    input,
    async (d, user) => {
      const before = await db.client.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundError("Client");
      const data = clientData(d);
      await db.$transaction(async (tx) => {
        const updated = await tx.client.update({ where: { id }, data });
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "CLIENT",
          entityId: id,
          changes: diff(before, data),
        });
        await queueContactUpdate(tx, updated);
        if (
          before.name !== updated.name ||
          before.phone !== updated.phone ||
          before.altPhone !== updated.altPhone
        )
          await queueCalendarSyncForJobs(tx, { clientId: id, deletedAt: null });
      });
      kickXeroSync();
      kickCalendarSync();
      revalidatePath(`/clients/${id}`);
      revalidatePath("/clients");
      return { id };
    },
  );
}

export async function deleteClient(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "clients"] },
    input,
    async ({ id }, user) => {
      const openInvoices = await db.invoice.count({
        where: {
          clientId: id,
          deletedAt: null,
          status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        },
      });
      if (openInvoices > 0)
        throw new UserError("This client has unpaid invoices. Settle or void them first.");
      await db.$transaction(async (tx) => {
        await tx.client.update({ where: { id }, data: { deletedAt: new Date() } });
        await audit(tx, { userId: user.id, action: "DELETE", entityType: "CLIENT", entityId: id });
      });
      revalidatePath("/clients");
      return null;
    },
  );
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export async function saveContact(input: z.input<typeof contactSchema>) {
  return runAction(
    { schema: contactSchema, permission: ["update", "clients"] },
    input,
    async (d, user) => {
      const { id, ...data } = d;
      const contact = await db.$transaction(async (tx) => {
        if (data.isPrimary) {
          await tx.contact.updateMany({
            where: { clientId: data.clientId, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        const saved = id
          ? await tx.contact.update({ where: { id, clientId: data.clientId }, data })
          : await tx.contact.create({ data });
        await audit(tx, {
          userId: user.id,
          action: id ? "UPDATE" : "CREATE",
          entityType: "CLIENT",
          entityId: data.clientId,
          changes: { contact: data },
        });
        return saved;
      });
      if (id) kickCalendarSync();
      revalidatePath(`/clients/${d.clientId}`);
      return { id: contact.id };
    },
  );
}

export async function deleteContact(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "clients"] },
    input,
    async ({ id }, user) => {
      const contact = await db.contact.delete({ where: { id } });
      await audit(db, {
        userId: user.id,
        action: "DELETE",
        entityType: "CLIENT",
        entityId: contact.clientId,
        changes: { contact: contact.name },
      });
      revalidatePath(`/clients/${contact.clientId}`);
      return null;
    },
  );
}

// ─── Properties ──────────────────────────────────────────────────────────────

export async function saveProperty(id: string | null, input: z.input<typeof propertySchema>) {
  return runAction(
    { schema: propertySchema, permission: ["update", "clients"] },
    input,
    async (d, user) => {
      const property = await db.$transaction(async (tx) => {
        const before = id ? await tx.property.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundError("Property");
        const saved = id
          ? await tx.property.update({ where: { id }, data: d })
          : await tx.property.create({ data: d });
        await audit(tx, {
          userId: user.id,
          action: id ? "UPDATE" : "CREATE",
          entityType: "PROPERTY",
          entityId: saved.id,
          changes: id ? diff(before, d) : d,
        });
        if (id) await queueCalendarSyncForJobs(tx, { propertyId: id, deletedAt: null });
        if (!id) {
          await logActivity(tx, {
            entityType: "CLIENT",
            entityId: d.clientId,
            body: `Property added: ${d.addressLine1}, ${d.suburb}`,
            userId: user.id,
          });
        }
        return saved;
      });
      revalidatePath(`/clients/${d.clientId}`);
      revalidatePath(`/properties/${property.id}`);
      return { id: property.id };
    },
  );
}

export async function deleteProperty(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "clients"] },
    input,
    async ({ id }, user) => {
      const jobs = await db.job.count({ where: { propertyId: id, deletedAt: null } });
      if (jobs > 0)
        throw new UserError("This property has jobs. It can't be deleted, but you can edit it.");
      const property = await db.property.delete({ where: { id } });
      await audit(db, {
        userId: user.id,
        action: "DELETE",
        entityType: "PROPERTY",
        entityId: id,
        changes: { address: property.addressLine1 },
      });
      revalidatePath(`/clients/${property.clientId}`);
      return { clientId: property.clientId };
    },
  );
}
