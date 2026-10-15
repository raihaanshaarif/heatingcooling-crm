"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { JobStatus } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/numbering";
import { JOB_STATUS_LABELS, PLAN_FREQUENCY_MONTHS } from "@/lib/labels";
import { addMelbourneMonths, formatDateTime, minutesBetween } from "@/lib/dates";
import { can, ForbiddenError } from "@/lib/permissions";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  deleteFile,
  keyFromUrl,
  saveFile,
} from "@/lib/storage";
import {
  assignSchema,
  checklistAddSchema,
  checklistToggleSchema,
  jobCompletionSchema,
  jobLineItemSchema,
  jobNoteSchema,
  jobSchema,
  jobStatusSchema,
  linkEquipmentSchema,
  rescheduleSchema,
  signatureSchema,
  timeEntrySchema,
} from "@/lib/validations/jobs";
import type { SessionUser } from "@/lib/auth/session";
import { describeSmsResult, sendOnMyWaySms } from "@/server/sms/service";
import { getCurrentUser } from "@/lib/auth/session";
import {
  NotFoundError,
  UserError,
  idSchema,
  runAction,
  toErrorResult,
  type ActionResult,
} from "@/server/action";
import { audit, diff, logActivity, notifyUsers } from "@/server/audit";
import {
  deductForJobLine,
  describeStockNote,
  returnForJobLine,
  type StockNote,
} from "@/server/inventory/service";
import { kickCalendarSync, queueJobCalendarSync } from "@/server/google-calendar/queue";
import { applyChecklist, loadJobFor } from "./service";

function revalidateJob(id?: string) {
  revalidatePath("/jobs");
  revalidatePath("/schedule");
  revalidatePath("/my-jobs");
  revalidatePath("/dashboard");
  if (id) {
    revalidatePath(`/jobs/${id}`);
    revalidatePath(`/my-jobs/${id}`);
  }
}

async function syncAssignments(tx: Tx, jobId: string, userIds: string[]) {
  const current = await tx.jobAssignment.findMany({ where: { jobId } });
  const keep = new Set(userIds);
  await tx.jobAssignment.deleteMany({ where: { jobId, userId: { notIn: userIds } } });
  const add = userIds.filter((u) => !current.some((c) => c.userId === u));
  if (add.length)
    await tx.jobAssignment.createMany({ data: add.map((userId) => ({ jobId, userId })) });
  return { added: add, removed: current.filter((c) => !keep.has(c.userId)).map((c) => c.userId) };
}

async function syncEquipment(tx: Tx, jobId: string, equipmentIds: string[]) {
  await tx.jobEquipment.deleteMany({ where: { jobId, equipmentId: { notIn: equipmentIds } } });
  const current = await tx.jobEquipment.findMany({
    where: { jobId },
    select: { equipmentId: true },
  });
  const add = equipmentIds.filter((e) => !current.some((c) => c.equipmentId === e));
  if (add.length)
    await tx.jobEquipment.createMany({ data: add.map((equipmentId) => ({ jobId, equipmentId })) });
}

export async function createJob(input: z.input<typeof jobSchema>) {
  return runAction(
    { schema: jobSchema, permission: ["create", "jobs"] },
    input,
    async (d, user) => {
      const job = await db.$transaction(async (tx) => {
        const client = await tx.client.findFirst({ where: { id: d.clientId, deletedAt: null } });
        if (!client) throw new NotFoundError("Client");
        const number = await nextDocumentNumber(tx, "JOB");
        const scheduled = !!d.scheduledStart;
        const end =
          d.scheduledEnd ??
          (d.scheduledStart && d.estimatedMinutes
            ? new Date(d.scheduledStart.getTime() + d.estimatedMinutes * 60_000)
            : null);
        const created = await tx.job.create({
          data: {
            number,
            clientId: d.clientId,
            propertyId: d.propertyId,
            quoteId: d.quoteId,
            maintenancePlanId: d.maintenancePlanId,
            type: d.type,
            priority: d.priority,
            serviceCategory: d.serviceCategory,
            title: d.title,
            description: d.description,
            scheduledStart: d.scheduledStart,
            scheduledEnd:
              end ??
              (d.scheduledStart ? new Date(d.scheduledStart.getTime() + 2 * 3600_000) : null),
            estimatedMinutes:
              d.estimatedMinutes ??
              (d.scheduledStart && end ? minutesBetween(d.scheduledStart, end) : null),
            status: scheduled ? "SCHEDULED" : "UNSCHEDULED",
          },
        });
        await syncAssignments(tx, created.id, d.assigneeIds);
        await syncEquipment(tx, created.id, d.equipmentIds);
        if (d.applyChecklist) await applyChecklist(tx, created.id, d.type, d.serviceCategory);
        await logActivity(tx, {
          entityType: "JOB",
          entityId: created.id,
          body: `Job ${number} created`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "JOB",
          entityId: created.id,
          changes: { number, title: d.title },
        });
        if (d.scheduledStart && d.assigneeIds.length) await queueJobCalendarSync(tx, created.id);
        if (d.assigneeIds.length) {
          await notifyUsers(
            tx,
            d.assigneeIds.filter((u) => u !== user.id),
            {
              title: `New job ${number}: ${d.title}`,
              body: d.scheduledStart ? formatDateTime(d.scheduledStart) : "Not scheduled yet",
              link: `/my-jobs/${created.id}`,
            },
          );
        }
        return created;
      });
      kickCalendarSync();
      revalidateJob();
      return { id: job.id };
    },
  );
}

export async function updateJob(id: string, input: z.input<typeof jobSchema>) {
  return runAction(
    { schema: jobSchema, permission: ["update", "schedule"] },
    input,
    async (d, user) => {
      await db.$transaction(async (tx) => {
        const before = await tx.job.findFirst({ where: { id, deletedAt: null } });
        if (!before) throw new NotFoundError("Job");
        const data = {
          clientId: d.clientId,
          propertyId: d.propertyId,
          type: d.type,
          priority: d.priority,
          serviceCategory: d.serviceCategory,
          title: d.title,
          description: d.description,
          scheduledStart: d.scheduledStart,
          scheduledEnd: d.scheduledEnd,
          estimatedMinutes: d.estimatedMinutes,
          status:
            before.status === "UNSCHEDULED" && d.scheduledStart
              ? ("SCHEDULED" as const)
              : before.status === "SCHEDULED" && !d.scheduledStart
                ? ("UNSCHEDULED" as const)
                : before.status,
        };
        await tx.job.update({ where: { id }, data });
        const { added } = await syncAssignments(tx, id, d.assigneeIds);
        await syncEquipment(tx, id, d.equipmentIds);
        await queueJobCalendarSync(tx, id);
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "JOB",
          entityId: id,
          changes: diff(before, data),
        });
        if (added.length) {
          await notifyUsers(
            tx,
            added.filter((u) => u !== user.id),
            {
              title: `Assigned to ${before.number}: ${d.title}`,
              body: d.scheduledStart ? formatDateTime(d.scheduledStart) : undefined,
              link: `/my-jobs/${id}`,
            },
          );
        }
      });
      kickCalendarSync();
      revalidateJob(id);
      return { id };
    },
  );
}

const TECH_STATUSES: JobStatus[] = ["EN_ROUTE", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "SCHEDULED"];

export async function updateJobStatus(input: z.input<typeof jobStatusSchema>) {
  return runAction(
    { schema: jobStatusSchema, permission: ["update", "jobs"] },
    input,
    async ({ id, status, onHoldReason }, user) => {
      if (user.role === "TECHNICIAN" && !TECH_STATUSES.includes(status))
        throw new ForbiddenError("Ask the office to change this status.");
      const changed = await db.$transaction(async (tx) => {
        const job = await loadJobFor(user, id, tx);
        if (job.status === status) return false;
        if (job.status === "INVOICED" && user.role === "TECHNICIAN")
          throw new ForbiddenError("This job is already invoiced.");
        const now = new Date();
        const data: Record<string, unknown> = {
          status,
          onHoldReason: status === "ON_HOLD" ? onHoldReason : null,
        };
        if (status === "EN_ROUTE") data.enRouteAt = now;
        if (status === "IN_PROGRESS" && !job.actualStart) data.actualStart = now;
        if (status === "COMPLETED") {
          data.actualEnd = now;
          if (!job.actualStart) data.actualStart = job.enRouteAt ?? now;
        }
        await tx.job.update({ where: { id }, data });
        await queueJobCalendarSync(tx, id);

        // Technician timer: starting work opens a time entry, finishing/pausing closes it.
        if (status === "IN_PROGRESS" && user.role === "TECHNICIAN") {
          const open = await tx.timeEntry.findFirst({
            where: { jobId: id, userId: user.id, endedAt: null },
          });
          if (!open)
            await tx.timeEntry.create({ data: { jobId: id, userId: user.id, startedAt: now } });
        }
        if (status === "COMPLETED" || status === "ON_HOLD") {
          const open = await tx.timeEntry.findMany({ where: { jobId: id, endedAt: null } });
          for (const entry of open) {
            await tx.timeEntry.update({
              where: { id: entry.id },
              data: { endedAt: now, minutes: minutesBetween(entry.startedAt, now) },
            });
          }
        }
        if (status === "COMPLETED" && job.maintenancePlanId)
          await rollPlanForward(tx, job.maintenancePlanId, now);

        await logActivity(tx, {
          entityType: "JOB",
          entityId: id,
          type: "STATUS_CHANGE",
          body: `${JOB_STATUS_LABELS[job.status]} → ${JOB_STATUS_LABELS[status]}${status === "ON_HOLD" && onHoldReason ? `: ${onHoldReason}` : ""}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "STATUS",
          entityType: "JOB",
          entityId: id,
          changes: { status: { from: job.status, to: status } },
        });
        return true;
      });
      if (changed) kickCalendarSync();
      // Text the client after the status change is saved; a failed text never blocks the job.
      let sms: string | undefined;
      if (changed && status === "EN_ROUTE") {
        try {
          sms = describeSmsResult(await sendOnMyWaySms(id, user));
        } catch (error) {
          console.error("[sms] on my way failed", error);
          sms = "Text failed to send";
        }
      }
      revalidateJob(id);
      return { id, status, sms };
    },
  );
}

/** When a maintenance job is completed, move the plan's next due date on by one period. */
async function rollPlanForward(tx: Tx, planId: string, completedAt: Date) {
  const plan = await tx.maintenancePlan.findUnique({ where: { id: planId } });
  if (!plan) return;
  let next = plan.nextDueDate;
  const months = PLAN_FREQUENCY_MONTHS[plan.frequency];
  // Roll forward past the completion date so an overdue plan doesn't stay overdue.
  do next = addMelbourneMonths(next, months);
  while (next <= completedAt);
  await tx.maintenancePlan.update({ where: { id: planId }, data: { nextDueDate: next } });
}

export async function saveJobCompletion(input: z.input<typeof jobCompletionSchema>) {
  return runAction(
    { schema: jobCompletionSchema, permission: ["update", "jobs"] },
    input,
    async (d, user) => {
      const { id, ...data } = d;
      await db.$transaction(async (tx) => {
        const job = await loadJobFor(user, id, tx);
        await tx.job.update({ where: { id }, data });
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "JOB",
          entityId: id,
          changes: diff(
            {
              completionNotes: job.completionNotes,
              refrigerantRecoveredKg: job.refrigerantRecoveredKg?.toString() ?? null,
              refrigerantAddedKg: job.refrigerantAddedKg?.toString() ?? null,
              gasComplianceCertNumber: job.gasComplianceCertNumber,
              signedByName: job.signedByName,
            },
            {
              ...data,
              refrigerantRecoveredKg: data.refrigerantRecoveredKg?.toString() ?? null,
              refrigerantAddedKg: data.refrigerantAddedKg?.toString() ?? null,
            },
          ),
        });
      });
      revalidateJob(id);
      return { id };
    },
  );
}

export async function assignTechnicians(input: z.input<typeof assignSchema>) {
  return runAction(
    { schema: assignSchema, permission: ["update", "schedule"] },
    input,
    async ({ id, assigneeIds }, user) => {
      await db.$transaction(async (tx) => {
        const job = await tx.job.findFirst({ where: { id, deletedAt: null } });
        if (!job) throw new NotFoundError("Job");
        const { added } = await syncAssignments(tx, id, assigneeIds);
        await queueJobCalendarSync(tx, id);
        await audit(tx, {
          userId: user.id,
          action: "ASSIGN",
          entityType: "JOB",
          entityId: id,
          changes: { assigneeIds },
        });
        await notifyUsers(
          tx,
          added.filter((u) => u !== user.id),
          {
            title: `Assigned to ${job.number}: ${job.title}`,
            body: job.scheduledStart ? formatDateTime(job.scheduledStart) : undefined,
            link: `/my-jobs/${id}`,
          },
        );
      });
      kickCalendarSync();
      revalidateJob(id);
      return { id };
    },
  );
}

export async function linkJobEquipment(input: z.input<typeof linkEquipmentSchema>) {
  return runAction(
    { schema: linkEquipmentSchema, permission: ["update", "jobs"] },
    input,
    async ({ id, equipmentIds }, user) => {
      await db.$transaction(async (tx) => {
        await loadJobFor(user, id, tx);
        await syncEquipment(tx, id, equipmentIds);
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "JOB",
          entityId: id,
          changes: { equipmentIds },
        });
      });
      revalidateJob(id);
      return { id };
    },
  );
}

/** Drag / resize on the dispatch board. */
export async function rescheduleJob(input: z.input<typeof rescheduleSchema>) {
  return runAction(
    { schema: rescheduleSchema, permission: ["update", "schedule"] },
    input,
    async ({ id, start, end, technicianId }, user) => {
      await db.$transaction(async (tx) => {
        const job = await tx.job.findFirst({ where: { id, deletedAt: null } });
        if (!job) throw new NotFoundError("Job");
        if (["COMPLETED", "INVOICED", "CANCELLED"].includes(job.status))
          throw new UserError("Completed or cancelled jobs can't be moved.");
        await tx.job.update({
          where: { id },
          data: {
            scheduledStart: start,
            scheduledEnd: end,
            estimatedMinutes: minutesBetween(start, end),
            status: job.status === "UNSCHEDULED" ? "SCHEDULED" : job.status,
          },
        });
        if (technicianId) {
          const exists = await tx.jobAssignment.findUnique({
            where: { jobId_userId: { jobId: id, userId: technicianId } },
          });
          if (!exists) {
            await tx.jobAssignment.deleteMany({ where: { jobId: id } });
            await tx.jobAssignment.create({ data: { jobId: id, userId: technicianId } });
          }
        }
        await queueJobCalendarSync(tx, id);
        await logActivity(tx, {
          entityType: "JOB",
          entityId: id,
          type: "SYSTEM",
          body: `Rescheduled to ${formatDateTime(start)}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "RESCHEDULE",
          entityType: "JOB",
          entityId: id,
          changes: {
            scheduledStart: { from: job.scheduledStart, to: start },
            scheduledEnd: { from: job.scheduledEnd, to: end },
          },
        });
      });
      kickCalendarSync();
      revalidateJob(id);
      return { id };
    },
  );
}

export async function unscheduleJob(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "schedule"] },
    input,
    async ({ id }, user) => {
      await db.$transaction(async (tx) => {
        await tx.job.update({
          where: { id },
          data: { scheduledStart: null, scheduledEnd: null, status: "UNSCHEDULED" },
        });
        await queueJobCalendarSync(tx, id);
        await logActivity(tx, {
          entityType: "JOB",
          entityId: id,
          type: "SYSTEM",
          body: "Removed from the schedule",
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "RESCHEDULE",
          entityType: "JOB",
          entityId: id,
          changes: { scheduledStart: null },
        });
      });
      kickCalendarSync();
      revalidateJob(id);
      return { id };
    },
  );
}

export async function deleteJob(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "jobs"] },
    input,
    async ({ id }, user) => {
      const invoices = await db.invoice.count({
        where: { jobId: id, deletedAt: null, status: { not: "VOID" } },
      });
      if (invoices > 0)
        throw new UserError("This job has invoices. Void them first, or cancel the job instead.");
      await db.$transaction(async (tx) => {
        await tx.job.update({ where: { id }, data: { deletedAt: new Date() } });
        await queueJobCalendarSync(tx, id);
        await audit(tx, { userId: user.id, action: "DELETE", entityType: "JOB", entityId: id });
      });
      kickCalendarSync();
      revalidateJob();
      return null;
    },
  );
}

// ─── Line items (labour / parts used) ───────────────────────────────────────

export async function addJobLineItem(input: z.input<typeof jobLineItemSchema>) {
  return runAction(
    { schema: jobLineItemSchema, permission: ["update", "jobs"] },
    input,
    async (d, user) => {
      const stock = await db.$transaction(async (tx) => {
        const job = await loadJobFor(user, d.jobId, tx);
        if (job.status === "INVOICED") throw new UserError("This job is already invoiced.");
        let unitPrice = d.unitPrice;
        let unitCost = d.unitCost ?? 0;
        // Technicians can't see prices: take them from the price book.
        if (!can(user, "view", "prices") || user.role === "TECHNICIAN") {
          if (d.priceBookItemId) {
            const item = await tx.priceBookItem.findUnique({ where: { id: d.priceBookItemId } });
            unitPrice = item?.priceCents ?? 0;
            unitCost = item?.costCents ?? 0;
          } else {
            unitPrice = 0;
            unitCost = 0;
          }
        } else if (d.priceBookItemId && d.unitCost === undefined) {
          const item = await tx.priceBookItem.findUnique({ where: { id: d.priceBookItemId } });
          unitCost = item?.costCents ?? 0;
        }
        if (d.type === "LABOUR" && unitCost === 0) {
          const tech = await tx.user.findUnique({
            where: { id: user.id },
            select: { hourlyCostCents: true },
          });
          unitCost = tech?.hourlyCostCents ?? 0;
        }
        const count = await tx.jobLineItem.count({ where: { jobId: d.jobId } });
        const line = await tx.jobLineItem.create({
          data: {
            jobId: d.jobId,
            priceBookItemId: d.priceBookItemId,
            type: d.type,
            description: d.description,
            quantity: d.quantity,
            unitPriceCents: unitPrice,
            unitCostCents: unitCost,
            taxable: d.taxable,
            sortOrder: count,
          },
        });
        await logActivity(tx, {
          entityType: "JOB",
          entityId: d.jobId,
          type: "SYSTEM",
          body: `Added: ${d.quantity} × ${d.description}`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "JOB",
          entityId: d.jobId,
          changes: { lineAdded: d.description },
        });
        // Parts tracked in inventory come out of the technician's van (or the warehouse).
        const note: StockNote | null = await deductForJobLine(tx, {
          jobId: d.jobId,
          line: { ...line, quantity: d.quantity },
          actingUserId: user.id,
        });
        return note;
      });
      revalidateJob(d.jobId);
      if (stock) revalidatePath("/inventory");
      return {
        stockMessage: describeStockNote(stock, user.role === "TECHNICIAN"),
        negativeStock: stock?.negative ?? false,
      };
    },
  );
}

export async function deleteJobLineItem(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "jobs"] },
    input,
    async ({ id }, user) => {
      const line = await db.jobLineItem.findUnique({ where: { id } });
      if (!line) throw new NotFoundError("Line");
      const returned = await db.$transaction(async (tx) => {
        const job = await loadJobFor(user, line.jobId, tx);
        if (job.status === "INVOICED") throw new UserError("This job is already invoiced.");
        // Anything this line took from stock goes back where it came from.
        const returned = await returnForJobLine(tx, {
          jobId: line.jobId,
          lineId: id,
          actingUserId: user.id,
        });
        await tx.jobLineItem.delete({ where: { id } });
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "JOB",
          entityId: line.jobId,
          changes: { lineRemoved: line.description },
        });
        return returned;
      });
      revalidateJob(line.jobId);
      if (returned.length) revalidatePath("/inventory");
      return {
        stockMessage: returned.length
          ? `Returned to ${returned.map((r) => r.locationName).join(", ")}.`
          : null,
      };
    },
  );
}

// ─── Time entries ───────────────────────────────────────────────────────────

export async function addTimeEntry(input: z.input<typeof timeEntrySchema>) {
  return runAction(
    { schema: timeEntrySchema, permission: ["update", "jobs"] },
    input,
    async (d, user) => {
      const userId = user.role === "TECHNICIAN" || !d.userId ? user.id : d.userId;
      await db.$transaction(async (tx) => {
        await loadJobFor(user, d.jobId, tx);
        await tx.timeEntry.create({
          data: {
            jobId: d.jobId,
            userId,
            startedAt: d.startedAt,
            endedAt: d.endedAt,
            minutes: d.endedAt ? minutesBetween(d.startedAt, d.endedAt) : null,
            note: d.note,
          },
        });
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "JOB",
          entityId: d.jobId,
          changes: { timeEntry: { userId, startedAt: d.startedAt, endedAt: d.endedAt } },
        });
      });
      revalidateJob(d.jobId);
      return null;
    },
  );
}

export async function stopTimeEntry(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "jobs"] },
    input,
    async ({ id }, user) => {
      const entry = await db.timeEntry.findUnique({ where: { id } });
      if (!entry) throw new NotFoundError("Time entry");
      if (user.role === "TECHNICIAN" && entry.userId !== user.id) throw new ForbiddenError();
      const now = new Date();
      await db.timeEntry.update({
        where: { id },
        data: { endedAt: now, minutes: minutesBetween(entry.startedAt, now) },
      });
      revalidateJob(entry.jobId);
      return null;
    },
  );
}

export async function deleteTimeEntry(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "jobs"] },
    input,
    async ({ id }, user) => {
      const entry = await db.timeEntry.findUnique({ where: { id } });
      if (!entry) throw new NotFoundError("Time entry");
      if (user.role === "TECHNICIAN" && entry.userId !== user.id) throw new ForbiddenError();
      await db.timeEntry.delete({ where: { id } });
      await audit(db, {
        userId: user.id,
        action: "UPDATE",
        entityType: "JOB",
        entityId: entry.jobId,
        changes: { timeEntryRemoved: id },
      });
      revalidateJob(entry.jobId);
      return null;
    },
  );
}

// ─── Checklist ──────────────────────────────────────────────────────────────

export async function toggleChecklistItem(input: z.input<typeof checklistToggleSchema>) {
  return runAction(
    { schema: checklistToggleSchema, permission: ["update", "jobs"] },
    input,
    async ({ itemId, checked, note }, user) => {
      const item = await db.jobChecklistItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundError("Checklist item");
      await loadJobFor(user, item.jobId);
      await db.jobChecklistItem.update({
        where: { id: itemId },
        data: { checked, ...(note !== null ? { note } : {}) },
      });
      revalidateJob(item.jobId);
      return null;
    },
  );
}

export async function addChecklistItem(input: z.input<typeof checklistAddSchema>) {
  return runAction(
    { schema: checklistAddSchema, permission: ["update", "jobs"] },
    input,
    async ({ jobId, label }, user) => {
      await loadJobFor(user, jobId);
      const count = await db.jobChecklistItem.count({ where: { jobId } });
      await db.jobChecklistItem.create({ data: { jobId, label, sortOrder: count } });
      revalidateJob(jobId);
      return null;
    },
  );
}

export async function applyChecklistTemplate(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "jobs"] },
    input,
    async ({ id }, user) => {
      const added = await db.$transaction(async (tx) => {
        const job = await loadJobFor(user, id, tx);
        return applyChecklist(tx, id, job.type, job.serviceCategory);
      });
      if (added === 0)
        throw new UserError(
          "No checklist template matches this job type. Add one in Settings → Checklists.",
        );
      revalidateJob(id);
      return { added };
    },
  );
}

// ─── Notes, photos, signature ───────────────────────────────────────────────

export async function addJobNote(input: z.input<typeof jobNoteSchema>) {
  return runAction(
    { schema: jobNoteSchema, permission: ["update", "jobs"] },
    input,
    async ({ id, body }, user) => {
      await loadJobFor(user, id);
      await logActivity(db, {
        entityType: "JOB",
        entityId: id,
        type: "NOTE",
        body,
        userId: user.id,
      });
      revalidateJob(id);
      return null;
    },
  );
}

const uploadMeta = z.object({
  jobId: z.string().min(1),
  kind: z.enum(["BEFORE", "AFTER", "PHOTO", "DOCUMENT"]).default("PHOTO"),
  caption: z.string().trim().max(200).optional(),
});

/** Upload one or more photos / documents to a job (multipart FormData). */
export async function uploadJobFiles(formData: FormData): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "Your session has expired." };
    if (!can(user, "update", "jobs")) throw new ForbiddenError();
    const meta = uploadMeta.parse({
      jobId: formData.get("jobId"),
      kind: formData.get("kind") ?? undefined,
      caption: formData.get("caption") || undefined,
    });
    await loadJobFor(user, meta.jobId);
    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new UserError("Choose at least one file.");
    if (files.length > 10) throw new UserError("Upload up to 10 files at a time.");
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) throw new UserError(`${file.name} is larger than 10 MB.`);
      if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type))
        throw new UserError(`${file.name}: only photos and PDFs are allowed.`);
    }
    for (const file of files) {
      const stored = await saveFile({
        folder: `jobs/${meta.jobId}`,
        fileName: file.name,
        contentType: file.type,
        body: Buffer.from(await file.arrayBuffer()),
      });
      await db.attachment.create({
        data: {
          entityType: "JOB",
          entityId: meta.jobId,
          url: stored.url,
          storageKey: stored.key,
          fileName: file.name,
          mimeType: file.type,
          size: stored.size,
          caption: meta.caption ?? null,
          kind: meta.kind,
          uploadedById: user.id,
        },
      });
    }
    await logActivity(db, {
      entityType: "JOB",
      entityId: meta.jobId,
      type: "SYSTEM",
      body: `${files.length} file${files.length > 1 ? "s" : ""} uploaded (${meta.kind.toLowerCase()})`,
      userId: user.id,
    });
    revalidateJob(meta.jobId);
    return { ok: true, data: { count: files.length } };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function deleteAttachment(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "jobs"] },
    input,
    async ({ id }, user) => {
      const attachment = await db.attachment.findUnique({ where: { id } });
      if (!attachment) throw new NotFoundError("File");
      if (attachment.entityType === "JOB") await loadJobFor(user, attachment.entityId);
      if (user.role === "TECHNICIAN" && attachment.uploadedById !== user.id)
        throw new ForbiddenError("You can only delete your own uploads.");
      await db.attachment.delete({ where: { id } });
      const key = attachment.storageKey ?? keyFromUrl(attachment.url);
      if (key) await deleteFile(key).catch(() => undefined);
      await audit(db, {
        userId: user.id,
        action: "DELETE",
        entityType: attachment.entityType,
        entityId: attachment.entityId,
        changes: { file: attachment.fileName },
      });
      revalidateJob(attachment.entityId);
      return null;
    },
  );
}

export async function saveSignature(input: z.input<typeof signatureSchema>) {
  return runAction(
    { schema: signatureSchema, permission: ["update", "jobs"] },
    input,
    async ({ id, signedByName, dataUrl }, user: SessionUser) => {
      await loadJobFor(user, id);
      const body = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
      const stored = await saveFile({
        folder: `jobs/${id}/signatures`,
        fileName: "signature.png",
        contentType: "image/png",
        body,
      });
      await db.$transaction(async (tx) => {
        await tx.attachment.create({
          data: {
            entityType: "JOB",
            entityId: id,
            url: stored.url,
            storageKey: stored.key,
            fileName: "signature.png",
            mimeType: "image/png",
            size: stored.size,
            caption: `Signed by ${signedByName}`,
            kind: "SIGNATURE",
            uploadedById: user.id,
          },
        });
        await tx.job.update({
          where: { id },
          data: { customerSignatureUrl: stored.url, signedByName },
        });
        await logActivity(tx, {
          entityType: "JOB",
          entityId: id,
          type: "SYSTEM",
          body: `Customer signature captured (${signedByName})`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "SIGN",
          entityType: "JOB",
          entityId: id,
          changes: { signedByName },
        });
      });
      revalidateJob(id);
      return { url: stored.url };
    },
  );
}

/** Equipment at a property, for the job form's equipment picker. */
export async function getPropertyEquipmentOptions(input: { id: string }) {
  return runAction({ schema: idSchema, permission: ["view", "jobs"] }, input, async ({ id }) => {
    const items = await db.equipment.findMany({
      where: { propertyId: id },
      orderBy: { createdAt: "asc" },
    });
    return items.map((e) => ({
      value: e.id,
      label: `${e.brand} ${e.model ?? ""}`.trim(),
      hint: [e.location, e.serialNumber].filter(Boolean).join(" · ") || undefined,
    }));
  });
}

const rangeSchema = z.object({ start: z.coerce.date(), end: z.coerce.date() });

/** Calendar feed for the dispatch board. */
export async function getScheduleEvents(input: { start: string; end: string }) {
  return runAction(
    { schema: rangeSchema, permission: ["view", "schedule"] },
    input,
    async ({ start, end }) => {
      const jobs = await db.job.findMany({
        where: {
          deletedAt: null,
          status: { not: "CANCELLED" },
          scheduledStart: { lt: end },
          scheduledEnd: { gt: start },
        },
        include: {
          client: { select: { name: true } },
          property: { select: { suburb: true } },
          assignments: { include: { user: { select: { id: true, name: true, color: true } } } },
        },
        orderBy: { scheduledStart: "asc" },
      });
      return jobs.map((j) => ({
        id: j.id,
        number: j.number,
        title: j.title,
        status: j.status,
        priority: j.priority,
        clientName: j.client.name,
        suburb: j.property?.suburb ?? null,
        start: j.scheduledStart!.toISOString(),
        end: (j.scheduledEnd ?? new Date(j.scheduledStart!.getTime() + 2 * 3600_000)).toISOString(),
        technicians: j.assignments.map((a) => a.user),
      }));
    },
  );
}
