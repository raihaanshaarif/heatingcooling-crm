"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { equipmentSchema } from "@/lib/validations/clients";
import { NotFoundError, idSchema, runAction } from "@/server/action";
import { audit, diff, logActivity } from "@/server/audit";

export async function saveEquipment(id: string | null, input: z.input<typeof equipmentSchema>) {
  return runAction(
    { schema: equipmentSchema, permission: [id ? "update" : "create", "equipment"] },
    input,
    async (d, user) => {
      const saved = await db.$transaction(async (tx) => {
        const before = id ? await tx.equipment.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundError("Equipment");
        const record = id
          ? await tx.equipment.update({ where: { id }, data: d })
          : await tx.equipment.create({ data: d });
        await audit(tx, {
          userId: user.id,
          action: id ? "UPDATE" : "CREATE",
          entityType: "EQUIPMENT",
          entityId: record.id,
          changes:
            id && before
              ? diff(
                  { ...before, capacityKw: before.capacityKw?.toString() ?? null },
                  { ...d, capacityKw: d.capacityKw?.toString() ?? null },
                )
              : d,
        });
        if (!id) {
          const property = await tx.property.findUnique({
            where: { id: d.propertyId },
            select: { clientId: true },
          });
          if (property) {
            await logActivity(tx, {
              entityType: "CLIENT",
              entityId: property.clientId,
              body: `Equipment added: ${d.brand} ${d.model ?? ""}`.trim(),
              userId: user.id,
            });
          }
        }
        return record;
      });
      revalidatePath(`/properties/${d.propertyId}`);
      revalidatePath(`/equipment/${saved.id}`);
      revalidatePath("/equipment");
      return { id: saved.id };
    },
  );
}

export async function deleteEquipment(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["delete", "equipment"] },
    input,
    async ({ id }, user) => {
      const e = await db.equipment.delete({ where: { id } });
      await audit(db, {
        userId: user.id,
        action: "DELETE",
        entityType: "EQUIPMENT",
        entityId: id,
        changes: { brand: e.brand, model: e.model },
      });
      revalidatePath(`/properties/${e.propertyId}`);
      revalidatePath("/equipment");
      return { propertyId: e.propertyId };
    },
  );
}
