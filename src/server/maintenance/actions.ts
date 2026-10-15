"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/numbering";
import { maintenancePlanSchema } from "@/lib/validations/maintenance";
import { NotFoundError, UserError, idSchema, runAction } from "@/server/action";
import { audit, diff, logActivity } from "@/server/audit";
import { applyChecklist } from "@/server/jobs/service";

function revalidatePlans(clientId?: string) {
  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

export async function saveMaintenancePlan(
  id: string | null,
  input: z.input<typeof maintenancePlanSchema>,
) {
  return runAction(
    { schema: maintenancePlanSchema, permission: [id ? "update" : "create", "maintenance"] },
    input,
    async (d, user) => {
      const { equipmentIds, price, ...rest } = d;
      const data = { ...rest, priceCents: price };
      const plan = await db.$transaction(async (tx) => {
        const before = id ? await tx.maintenancePlan.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundError("Plan");
        const saved = id
          ? await tx.maintenancePlan.update({ where: { id }, data })
          : await tx.maintenancePlan.create({ data });
        await tx.maintenancePlanEquipment.deleteMany({
          where: { planId: saved.id, equipmentId: { notIn: equipmentIds } },
        });
        const existing = await tx.maintenancePlanEquipment.findMany({
          where: { planId: saved.id },
          select: { equipmentId: true },
        });
        const add = equipmentIds.filter((e) => !existing.some((x) => x.equipmentId === e));
        if (add.length)
          await tx.maintenancePlanEquipment.createMany({
            data: add.map((equipmentId) => ({ planId: saved.id, equipmentId })),
          });
        await audit(tx, {
          userId: user.id,
          action: id ? "UPDATE" : "CREATE",
          entityType: "MAINTENANCE_PLAN",
          entityId: saved.id,
          changes: id ? diff(before, data) : data,
        });
        if (!id)
          await logActivity(tx, {
            entityType: "CLIENT",
            entityId: d.clientId,
            body: `Maintenance plan added: ${d.name}`,
            userId: user.id,
          });
        return saved;
      });
      revalidatePlans(plan.clientId);
      return { id: plan.id };
    },
  );
}

export async function deleteMaintenancePlan(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "maintenance"] },
    input,
    async ({ id }, user) => {
      const plan = await db.maintenancePlan.findUnique({ where: { id } });
      if (!plan) throw new NotFoundError("Plan");
      await db.$transaction(async (tx) => {
        await tx.maintenancePlan.delete({ where: { id } });
        await audit(tx, {
          userId: user.id,
          action: "DELETE",
          entityType: "MAINTENANCE_PLAN",
          entityId: id,
          changes: { name: plan.name },
        });
      });
      revalidatePlans(plan.clientId);
      return null;
    },
  );
}

/** Book the next service: an unscheduled maintenance job linked to the plan and its equipment. */
export async function createJobFromPlan(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["create", "jobs"] },
    input,
    async ({ id }, user) => {
      const job = await db.$transaction(async (tx) => {
        const plan = await tx.maintenancePlan.findUnique({
          where: { id },
          include: { equipment: true, client: true },
        });
        if (!plan) throw new NotFoundError("Plan");
        if (plan.client.doNotService)
          throw new UserError(`${plan.client.name} is flagged “Do not service”.`);
        const open = await tx.job.findFirst({
          where: {
            maintenancePlanId: id,
            deletedAt: null,
            status: { notIn: ["CANCELLED", "COMPLETED", "INVOICED"] },
          },
        });
        if (open) throw new UserError(`${open.number} is already booked for this plan.`);
        const number = await nextDocumentNumber(tx, "JOB");
        const created = await tx.job.create({
          data: {
            number,
            clientId: plan.clientId,
            propertyId: plan.propertyId,
            maintenancePlanId: plan.id,
            type: "SERVICE",
            serviceCategory: "MAINTENANCE",
            title: plan.name,
            description: plan.notes,
            status: "UNSCHEDULED",
            estimatedMinutes: 60 + 30 * Math.max(0, plan.equipment.length - 1),
            equipment: { create: plan.equipment.map((e) => ({ equipmentId: e.equipmentId })) },
          },
        });
        await applyChecklist(tx, created.id, "SERVICE", "MAINTENANCE");
        await logActivity(tx, {
          entityType: "JOB",
          entityId: created.id,
          body: `Created from maintenance plan “${plan.name}”`,
          userId: user.id,
        });
        await audit(tx, {
          userId: user.id,
          action: "CREATE",
          entityType: "JOB",
          entityId: created.id,
          changes: { number, maintenancePlanId: id },
        });
        return created;
      });
      revalidatePlans();
      revalidatePath("/jobs");
      revalidatePath("/schedule");
      return { id: job.id };
    },
  );
}
