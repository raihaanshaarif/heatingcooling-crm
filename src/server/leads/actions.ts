"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/numbering";
import { LEAD_STATUS_LABELS, SERVICE_CATEGORY_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import {
  convertLeadSchema,
  followUpSchema,
  leadSchema,
  leadStatusSchema,
  markLostSchema,
} from "@/lib/validations/leads";
import { NotFoundError, UserError, idSchema, runAction } from "@/server/action";
import { audit, diff, logActivity } from "@/server/audit";
import { createLeadRecord } from "./service";

function revalidateLead(id?: string) {
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/leads/${id}`);
}

export async function createLead(input: z.input<typeof leadSchema>) {
  return runAction(
    { schema: leadSchema, permission: ["create", "leads"] },
    input,
    async (d, user) => {
      const lead = await db.$transaction((tx) =>
        createLeadRecord(
          tx,
          {
            name: d.name,
            email: d.email,
            phone: d.phone,
            suburb: d.suburb,
            postcode: d.postcode,
            status: d.status,
            source: d.source,
            sourceDetail: d.sourceDetail,
            serviceCategory: d.serviceCategory,
            brand: d.brand,
            message: d.message,
            urgency: d.urgency,
            estimatedValueCents: d.estimatedValue,
            assignedToId: d.assignedToId ?? user.id,
            followUpAt: d.followUpAt,
          },
          user.id,
        ),
      );
      revalidateLead();
      return { id: lead.id };
    },
  );
}

export async function updateLead(id: string, input: z.input<typeof leadSchema>) {
  return runAction(
    { schema: leadSchema, permission: ["update", "leads"] },
    input,
    async (d, user) => {
      const before = await db.lead.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundError("Lead");
      const data = {
        name: d.name,
        email: d.email,
        phone: d.phone,
        suburb: d.suburb,
        postcode: d.postcode,
        status: d.status,
        source: d.source,
        sourceDetail: d.sourceDetail,
        serviceCategory: d.serviceCategory,
        brand: d.brand,
        message: d.message,
        urgency: d.urgency,
        estimatedValueCents: d.estimatedValue,
        assignedToId: d.assignedToId,
        followUpAt: d.followUpAt,
      };
      await db.$transaction(async (tx) => {
        await tx.lead.update({ where: { id }, data });
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "LEAD",
          entityId: id,
          changes: diff(before, data),
        });
        if (before.status !== d.status) {
          await logActivity(tx, {
            entityType: "LEAD",
            entityId: id,
            type: "STATUS_CHANGE",
            body: `Status changed from ${LEAD_STATUS_LABELS[before.status]} to ${LEAD_STATUS_LABELS[d.status]}`,
            userId: user.id,
          });
        }
      });
      revalidateLead(id);
      return { id };
    },
  );
}

/** Used by the kanban board (drag between columns) and the status menu. */
export async function updateLeadStatus(input: z.input<typeof leadStatusSchema>) {
  return runAction(
    { schema: leadStatusSchema, permission: ["update", "leads"] },
    input,
    async ({ id, status }, user) => {
      const lead = await db.lead.findFirst({ where: { id, deletedAt: null } });
      if (!lead) throw new NotFoundError("Lead");
      if (lead.status === status) return { id };
      if (status === "LOST") throw new UserError("Use “Mark lost” so the reason is recorded.");
      await db.$transaction(async (tx) => {
        await tx.lead.update({ where: { id }, data: { status, lostReason: null } });
        await logActivity(tx, {
          entityType: "LEAD",
          entityId: id,
          type: "STATUS_CHANGE",
          body: `Status changed from ${LEAD_STATUS_LABELS[lead.status]} to ${LEAD_STATUS_LABELS[status]}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "STATUS",
          entityType: "LEAD",
          entityId: id,
          changes: { status: { from: lead.status, to: status } },
        });
      });
      revalidateLead(id);
      return { id };
    },
  );
}

export async function markLeadLost(input: z.input<typeof markLostSchema>) {
  return runAction(
    { schema: markLostSchema, permission: ["update", "leads"] },
    input,
    async ({ id, lostReason, note }, user) => {
      const lead = await db.lead.findFirst({ where: { id, deletedAt: null } });
      if (!lead) throw new NotFoundError("Lead");
      await db.$transaction(async (tx) => {
        await tx.lead.update({
          where: { id },
          data: { status: "LOST", lostReason, followUpAt: null },
        });
        await logActivity(tx, {
          entityType: "LEAD",
          entityId: id,
          type: "STATUS_CHANGE",
          body: `Marked lost: ${lostReason}${note ? `\n${note}` : ""}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "STATUS",
          entityType: "LEAD",
          entityId: id,
          changes: { status: "LOST", lostReason },
        });
      });
      revalidateLead(id);
      return { id };
    },
  );
}

export async function setLeadFollowUp(input: z.input<typeof followUpSchema>) {
  return runAction(
    { schema: followUpSchema, permission: ["update", "leads"] },
    input,
    async ({ id, followUpAt }, user) => {
      await db.$transaction(async (tx) => {
        await tx.lead.update({ where: { id }, data: { followUpAt } });
        await logActivity(tx, {
          entityType: "LEAD",
          entityId: id,
          type: "SYSTEM",
          body: followUpAt ? `Follow-up set for ${formatDate(followUpAt)}` : "Follow-up cleared",
          userId: user.id,
        });
      });
      revalidateLead(id);
      return { id };
    },
  );
}

export async function deleteLead(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "leads"] },
    input,
    async ({ id }, user) => {
      await db.$transaction(async (tx) => {
        await tx.lead.update({ where: { id }, data: { deletedAt: new Date() } });
        await audit(tx, { userId: user.id, action: "DELETE", entityType: "LEAD", entityId: id });
      });
      revalidateLead();
      return null;
    },
  );
}

/**
 * Convert a lead into a client (+ property), optionally creating an unscheduled
 * job straight away. Quotes are created on the quote builder with the lead linked.
 */
export async function convertLead(input: z.input<typeof convertLeadSchema>) {
  return runAction(
    { schema: convertLeadSchema, permission: ["create", "clients"] },
    input,
    async (d, user) => {
      const lead = await db.lead.findFirst({ where: { id: d.id, deletedAt: null } });
      if (!lead) throw new NotFoundError("Lead");
      const result = await db.$transaction(async (tx) => {
        let clientId = d.existingClientId ?? lead.clientId;
        let propertyId: string | null = null;
        if (clientId) {
          const client = await tx.client.findFirst({
            where: { id: clientId, deletedAt: null },
            include: { properties: { take: 1 } },
          });
          if (!client) throw new NotFoundError("Client");
          propertyId = client.properties[0]?.id ?? null;
        }
        if (d.addressLine1 && d.suburb && d.postcode) {
          if (!clientId) {
            const client = await tx.client.create({
              data: {
                type: d.clientType,
                name: lead.name,
                email: lead.email,
                phone: lead.phone,
                source: lead.source,
                billingLine1: d.addressLine1,
                billingSuburb: d.suburb,
                billingState: d.state,
                billingPostcode: d.postcode,
              },
            });
            clientId = client.id;
            await audit(tx, {
              userId: user.id,
              action: "CREATE",
              entityType: "CLIENT",
              entityId: client.id,
              changes: { fromLead: lead.id },
            });
            await logActivity(tx, {
              entityType: "CLIENT",
              entityId: client.id,
              body: `Client created from lead L-${lead.leadNumber}`,
              userId: user.id,
            });
          }
          const property = await tx.property.create({
            data: {
              clientId,
              addressLine1: d.addressLine1,
              suburb: d.suburb,
              state: d.state,
              postcode: d.postcode,
            },
          });
          propertyId = property.id;
        }
        if (!clientId) throw new UserError("Enter an address to create the client.");

        let jobId: string | null = null;
        if (d.next === "job") {
          const number = await nextDocumentNumber(tx, "JOB");
          const job = await tx.job.create({
            data: {
              number,
              clientId,
              propertyId,
              type:
                lead.serviceCategory === "EMERGENCY_REPAIR"
                  ? "EMERGENCY"
                  : lead.serviceCategory === "MAINTENANCE"
                    ? "SERVICE"
                    : "QUOTE_VISIT",
              priority: lead.urgency,
              serviceCategory: lead.serviceCategory,
              title: lead.serviceCategory
                ? `${SERVICE_CATEGORY_LABELS[lead.serviceCategory]}${lead.brand ? ` (${lead.brand})` : ""}`
                : `Job for ${lead.name}`,
              description: lead.message,
            },
          });
          jobId = job.id;
          await logActivity(tx, {
            entityType: "JOB",
            entityId: job.id,
            body: `Job created from lead L-${lead.leadNumber}`,
            userId: user.id,
          });
          await audit(tx, {
            userId: user.id,
            action: "CREATE",
            entityType: "JOB",
            entityId: job.id,
            changes: { fromLead: lead.id },
          });
        }

        const status = d.next === "job" ? "WON" : lead.status === "NEW" ? "CONTACTED" : lead.status;
        await tx.lead.update({
          where: { id: lead.id },
          data: { clientId, convertedAt: new Date(), status },
        });
        await logActivity(tx, {
          entityType: "LEAD",
          entityId: lead.id,
          type: "STATUS_CHANGE",
          body: `Converted to client${d.next === "job" ? " and job created" : d.next === "quote" ? ", quote started" : ""}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "CONVERT",
          entityType: "LEAD",
          entityId: lead.id,
          changes: { clientId, propertyId, jobId },
        });
        return { clientId, propertyId, jobId };
      });
      revalidateLead(d.id);
      revalidatePath("/clients");
      const redirectTo =
        d.next === "quote"
          ? `/quotes/new?clientId=${result.clientId}${result.propertyId ? `&propertyId=${result.propertyId}` : ""}&leadId=${d.id}`
          : d.next === "job" && result.jobId
            ? `/jobs/${result.jobId}`
            : `/clients/${result.clientId}`;
      return { ...result, redirectTo };
    },
  );
}
