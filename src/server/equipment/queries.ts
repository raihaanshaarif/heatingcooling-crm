import "server-only";
import { db } from "@/lib/db";
import { formatAddress, toNumber } from "@/lib/utils";

export async function listEquipment() {
  const rows = await db.equipment.findMany({
    where: { property: { client: { deletedAt: null } } },
    include: {
      property: { include: { client: { select: { id: true, name: true } } } },
      jobs: {
        include: { job: { select: { status: true, actualEnd: true, scheduledStart: true } } },
      },
    },
    orderBy: [{ brand: "asc" }, { createdAt: "desc" }],
  });
  return rows.map((e) => {
    const serviced = e.jobs
      .filter((j) => j.job.status === "COMPLETED" || j.job.status === "INVOICED")
      .map((j) => j.job.actualEnd ?? j.job.scheduledStart)
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime());
    return {
      id: e.id,
      type: e.type,
      brand: e.brand,
      model: e.model,
      serialNumber: e.serialNumber,
      capacityKw: toNumber(e.capacityKw),
      refrigerant: e.refrigerant,
      location: e.location,
      installDate: e.installDate,
      warrantyExpiresAt: e.warrantyExpiresAt,
      installedByUs: e.installedByUs,
      propertyId: e.propertyId,
      address: formatAddress(e.property),
      suburb: e.property.suburb,
      clientId: e.property.client.id,
      clientName: e.property.client.name,
      lastServicedAt: serviced[0] ?? null,
    };
  });
}
export type EquipmentRow = Awaited<ReturnType<typeof listEquipment>>[number];

export async function getEquipment(id: string) {
  const e = await db.equipment.findUnique({
    where: { id },
    include: {
      property: { include: { client: { select: { id: true, name: true, deletedAt: true } } } },
      jobs: {
        include: {
          job: {
            include: {
              assignments: { include: { user: { select: { name: true } } } },
            },
          },
        },
      },
      plans: { include: { plan: true } },
    },
  });
  if (!e || e.property.client.deletedAt) return null;
  const history = e.jobs
    .filter((j) => !j.job.deletedAt)
    .map((j) => ({
      id: j.job.id,
      number: j.job.number,
      title: j.job.title,
      type: j.job.type,
      status: j.job.status,
      date: j.job.actualEnd ?? j.job.scheduledStart ?? j.job.createdAt,
      technicians: j.job.assignments.map((a) => a.user.name),
      completionNotes: j.job.completionNotes,
      refrigerantAddedKg: toNumber(j.job.refrigerantAddedKg),
      refrigerantRecoveredKg: toNumber(j.job.refrigerantRecoveredKg),
      notes: j.notes,
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const { jobs: _jobs, ...rest } = e;
  return { ...rest, capacityKw: toNumber(e.capacityKw), history };
}
