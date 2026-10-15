import "server-only";
import { db } from "@/lib/db";

export async function listPlans() {
  const plans = await db.maintenancePlan.findMany({
    where: { client: { deletedAt: null } },
    include: {
      client: { select: { id: true, name: true, phone: true, email: true } },
      property: { select: { id: true, addressLine1: true, suburb: true } },
      equipment: { select: { equipmentId: true } },
      jobs: {
        where: { deletedAt: null, status: { notIn: ["CANCELLED", "COMPLETED", "INVOICED"] } },
        select: { id: true, number: true, scheduledStart: true },
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { nextDueDate: "asc" },
  });
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    clientId: p.client.id,
    clientName: p.client.name,
    clientPhone: p.client.phone,
    propertyId: p.propertyId,
    site: p.property ? `${p.property.addressLine1}, ${p.property.suburb}` : null,
    suburb: p.property?.suburb ?? null,
    frequency: p.frequency,
    priceCents: p.priceCents,
    startDate: p.startDate,
    nextDueDate: p.nextDueDate,
    active: p.active,
    notes: p.notes,
    equipmentIds: p.equipment.map((e) => e.equipmentId),
    openJob: p.jobs[0] ?? null,
  }));
}
export type PlanRow = Awaited<ReturnType<typeof listPlans>>[number];
