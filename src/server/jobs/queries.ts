import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { getTimeline } from "@/server/activity/queries";

export async function listJobs() {
  const jobs = await db.job.findMany({
    where: { deletedAt: null },
    include: {
      client: { select: { id: true, name: true } },
      property: { select: { suburb: true } },
      assignments: { include: { user: { select: { id: true, name: true, color: true } } } },
    },
    orderBy: [{ scheduledStart: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
  });
  return jobs.map((j) => ({
    id: j.id,
    number: j.number,
    title: j.title,
    type: j.type,
    status: j.status,
    priority: j.priority,
    serviceCategory: j.serviceCategory,
    clientId: j.client.id,
    clientName: j.client.name,
    suburb: j.property?.suburb ?? null,
    scheduledStart: j.scheduledStart,
    technicianIds: j.assignments.map((a) => a.user.id),
    technicians: j.assignments.map((a) => ({ name: a.user.name, color: a.user.color })),
    createdAt: j.createdAt,
  }));
}
export type JobRow = Awaited<ReturnType<typeof listJobs>>[number];

const jobInclude = {
  client: { include: { contacts: { orderBy: { isPrimary: "desc" as const } } } },
  property: true,
  quote: { select: { id: true, number: true } },
  maintenancePlan: { select: { id: true, name: true } },
  assignments: {
    include: {
      user: { select: { id: true, name: true, color: true, phone: true, hourlyCostCents: true } },
    },
  },
  equipment: { include: { equipment: true } },
  checklistItems: { orderBy: { sortOrder: "asc" as const } },
  lineItems: { orderBy: { sortOrder: "asc" as const } },
  timeEntries: {
    orderBy: { startedAt: "asc" as const },
    include: { user: { select: { id: true, name: true } } },
  },
  invoices: {
    where: { deletedAt: null },
    select: { id: true, number: true, status: true, totalCents: true },
  },
} satisfies Prisma.JobInclude;

export async function getJob(id: string, user: SessionUser) {
  const job = await db.job.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(user.role === "TECHNICIAN" ? { assignments: { some: { userId: user.id } } } : {}),
    },
    include: jobInclude,
  });
  if (!job) return null;
  const [attachments, timeline] = await Promise.all([
    db.attachment.findMany({
      where: { entityType: "JOB", entityId: id },
      orderBy: { createdAt: "asc" },
    }),
    getTimeline([{ entityType: "JOB", ids: [id] }]),
  ]);
  return {
    ...job,
    refrigerantRecoveredKg: toNumber(job.refrigerantRecoveredKg),
    refrigerantAddedKg: toNumber(job.refrigerantAddedKg),
    equipment: job.equipment.map((je) => ({
      ...je,
      equipment: { ...je.equipment, capacityKw: toNumber(je.equipment.capacityKw) },
    })),
    lineItems: job.lineItems.map((l) => ({ ...l, quantity: toNumber(l.quantity) ?? 0 })),
    attachments,
    timeline,
  };
}
export type JobDetail = NonNullable<Awaited<ReturnType<typeof getJob>>>;

/** People who can be assigned jobs: technicians, plus the owner (who often works on the tools). */
export async function getTechnicianOptions() {
  const users = await db.user.findMany({
    where: { active: true, role: { in: ["TECHNICIAN", "ADMIN"] } },
    select: { id: true, name: true, color: true, role: true },
    orderBy: [{ role: "desc" }, { name: "asc" }],
  });
  return users.map((u) => ({
    value: u.id,
    label: u.name,
    color: u.color,
    hint: u.role === "ADMIN" ? "Owner" : undefined,
  }));
}

export async function getEquipmentForProperty(propertyId: string) {
  const items = await db.equipment.findMany({
    where: { propertyId },
    orderBy: { createdAt: "asc" },
  });
  return items.map((e) => ({
    value: e.id,
    label: `${e.brand} ${e.model ?? ""}`.trim(),
    hint: e.location ?? undefined,
  }));
}

/** Technician's own jobs: today and upcoming, plus anything in progress. */
export async function getMyJobs(userId: string, from: Date) {
  const jobs = await db.job.findMany({
    where: {
      deletedAt: null,
      assignments: { some: { userId } },
      OR: [
        { scheduledStart: { gte: from } },
        { status: { in: ["EN_ROUTE", "IN_PROGRESS", "ON_HOLD"] } },
        { status: "SCHEDULED", scheduledStart: { lt: from } },
      ],
      status: { notIn: ["CANCELLED", "INVOICED"] },
    },
    include: { client: { select: { name: true, phone: true } }, property: true },
    orderBy: [{ scheduledStart: "asc" }],
    take: 100,
  });
  return jobs;
}

export async function listUnscheduledJobs() {
  const jobs = await db.job.findMany({
    where: { deletedAt: null, status: "UNSCHEDULED" },
    include: { client: { select: { name: true } }, property: { select: { suburb: true } } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  return jobs.map((j) => ({
    id: j.id,
    number: j.number,
    title: j.title,
    priority: j.priority,
    clientName: j.client.name,
    suburb: j.property?.suburb ?? null,
    estimatedMinutes: j.estimatedMinutes ?? 120,
  }));
}
export type UnscheduledJob = Awaited<ReturnType<typeof listUnscheduledJobs>>[number];
