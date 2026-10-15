import "server-only";
import { db } from "@/lib/db";
import { fromMelbourneInput, addMelbourneDays } from "@/lib/dates";
import { getTimeline } from "@/server/activity/queries";

export async function listLeads(range: { from?: string; to?: string } = {}) {
  const createdAt: { gte?: Date; lt?: Date } = {};
  if (range.from && /^\d{4}-\d{2}-\d{2}$/.test(range.from))
    createdAt.gte = fromMelbourneInput(range.from);
  if (range.to && /^\d{4}-\d{2}-\d{2}$/.test(range.to))
    createdAt.lt = addMelbourneDays(fromMelbourneInput(range.to), 1);
  const leads = await db.lead.findMany({
    where: { deletedAt: null, ...(createdAt.gte || createdAt.lt ? { createdAt } : {}) },
    include: { assignedTo: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return leads.map((l) => ({
    id: l.id,
    leadNumber: l.leadNumber,
    status: l.status,
    source: l.source,
    sourceDetail: l.sourceDetail,
    serviceCategory: l.serviceCategory,
    brand: l.brand,
    name: l.name,
    email: l.email,
    phone: l.phone,
    suburb: l.suburb,
    message: l.message,
    urgency: l.urgency,
    estimatedValueCents: l.estimatedValueCents,
    assignedToId: l.assignedToId ?? "unassigned",
    assignedToName: l.assignedTo?.name ?? null,
    followUpAt: l.followUpAt,
    clientId: l.clientId,
    createdAt: l.createdAt,
  }));
}
export type LeadRow = Awaited<ReturnType<typeof listLeads>>[number];

export async function getLead(id: string) {
  const lead = await db.lead.findFirst({
    where: { id, deletedAt: null },
    include: {
      assignedTo: { select: { id: true, name: true } },
      client: { select: { id: true, name: true, properties: { select: { id: true } } } },
      quotes: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!lead) return null;
  const timeline = await getTimeline([{ entityType: "LEAD", ids: [lead.id] }]);
  return { ...lead, timeline };
}
export type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLead>>>;

export async function getStaffOptions() {
  const users = await db.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "OFFICE"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ value: u.id, label: u.name }));
}
