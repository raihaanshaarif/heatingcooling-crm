import "server-only";
import type { JobType, Prisma, ServiceCategory } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { canAccessJob, ForbiddenError } from "@/lib/permissions";
import { NotFoundError } from "@/server/action";

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
