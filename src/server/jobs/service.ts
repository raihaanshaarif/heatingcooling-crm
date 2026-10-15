import "server-only";
import type { JobType, Prisma, ServiceCategory } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { canAccessJob, ForbiddenError } from "@/lib/permissions";
import { formatDateTime, minutesBetween } from "@/lib/dates";
import { NotFoundError, UserError } from "@/server/action";
import { audit, logActivity } from "@/server/audit";
import { queueJobCalendarSync } from "@/server/google-calendar/queue";

/** Load a job and make sure the user may work on it (technicians: only their own). */
export async function loadJobFor(user: SessionUser, id: string, client: Tx | typeof db = db) {
  const job = await client.job.findFirst({
    where: { id, deletedAt: null },
    include: { assignments: true },
  });
  if (!job) throw new NotFoundError("Job");
  if (!canAccessJob(user, job)) throw new ForbiddenError("This job isn't assigned to you.");
  return job;
}

/** Best checklist template for a job: exact type + category, then category, then type. */
export async function findChecklistTemplate(
  tx: Tx,
  type: JobType,
  category: ServiceCategory | null,
) {
  const candidates = await tx.jobChecklistTemplate.findMany({
    where: {
      active: true,
      OR: [{ jobType: type }, ...(category ? [{ serviceCategory: category }] : [])],
    },
  });
  const score = (t: (typeof candidates)[number]) =>
    (t.jobType === type ? 1 : 0) +
    (category && t.serviceCategory === category ? 2 : 0) -
    (t.jobType && t.jobType !== type ? 5 : 0) -
    (t.serviceCategory && t.serviceCategory !== category ? 5 : 0);
  return candidates.filter((t) => score(t) > 0).sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function templateItems(items: Prisma.JsonValue): string[] {
  return Array.isArray(items) ? items.filter((i): i is string => typeof i === "string") : [];
}

export async function applyChecklist(
  tx: Tx,
  jobId: string,
  type: JobType,
  category: ServiceCategory | null,
) {
  const template = await findChecklistTemplate(tx, type, category);
  if (!template) return 0;
  const existing = await tx.jobChecklistItem.count({ where: { jobId } });
  const labels = templateItems(template.items);
  await tx.jobChecklistItem.createMany({
    data: labels.map((label, i) => ({ jobId, label, sortOrder: existing + i })),
  });
  return labels.length;
}

/**
 * Move a job to a new time (inside the caller's transaction): the shared reschedule logic
 * behind drag-and-drop on the Schedule board and applying / undoing a route plan. Queues
 * the Google Calendar update and writes the timeline entry and audit log. The caller runs
 * kickCalendarSync() and revalidates after the transaction.
 */
export async function rescheduleJobInTx(
  tx: Tx,
  userId: string,
  input: { id: string; start: Date; end: Date; technicianId?: string | null; reason?: string },
) {
  const { id, start, end, technicianId } = input;
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
    body: `Rescheduled to ${formatDateTime(start)}${input.reason ? ` (${input.reason})` : ""}`,
    userId,
  });
  await audit(tx, {
    userId,
    action: "RESCHEDULE",
    entityType: "JOB",
    entityId: id,
    changes: {
      scheduledStart: { from: job.scheduledStart, to: start },
      scheduledEnd: { from: job.scheduledEnd, to: end },
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
  return job;
}
