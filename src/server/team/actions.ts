"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import type { z } from "zod";
import { db } from "@/lib/db";
import { changePasswordSchema, licenceSchema, userSchema } from "@/lib/validations/team";
import { NotFoundError, UserError, idSchema, runAction } from "@/server/action";
import { audit, diff } from "@/server/audit";
import { ensureStockLocations } from "@/server/inventory/service";

function revalidateTeam(id?: string) {
  revalidatePath("/team");
  revalidatePath("/schedule");
  if (id) revalidatePath(`/team/${id}`);
}

export async function saveUser(id: string | null, input: z.input<typeof userSchema>) {
  return runAction(
    { schema: userSchema, permission: [id ? "update" : "create", "users"] },
    input,
    async (d, actor) => {
      const { password, hourlyCost, ...rest } = d;
      const data = { ...rest, hourlyCostCents: hourlyCost };
      const clash = await db.user.findFirst({
        where: { email: d.email, ...(id ? { id: { not: id } } : {}) },
      });
      if (clash) throw new UserError("Someone already uses that email.");
      if (!id && !password) throw new UserError("Set a starting password for the new user.");
      if (id === actor.id && (d.role !== "ADMIN" || !d.active))
        throw new UserError("You can't remove your own admin access.");
      const user = await db.$transaction(async (tx) => {
        const before = id ? await tx.user.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundError("User");
        if (before?.role === "ADMIN" && (d.role !== "ADMIN" || !d.active)) {
          const admins = await tx.user.count({
            where: { role: "ADMIN", active: true, id: { not: id! } },
          });
          if (admins === 0) throw new UserError("There must be at least one active admin.");
        }
        const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
        const saved = id
          ? await tx.user.update({
              where: { id },
              data: { ...data, ...(passwordHash ? { passwordHash } : {}) },
            })
          : await tx.user.create({ data: { ...data, passwordHash } });
        await audit(tx, {
          userId: actor.id,
          action: id ? "UPDATE" : "CREATE",
          entityType: "USER",
          entityId: saved.id,
          changes: {
            ...(id ? diff(before, data) : data),
            ...(passwordHash ? { password: "changed" } : {}),
          },
        });
        return saved;
      });
      // New technicians get a van; leavers' vans are deactivated.
      await ensureStockLocations();
      revalidateTeam(user.id);
      revalidatePath("/inventory");
      return { id: user.id };
    },
  );
}

export async function saveLicence(id: string | null, input: z.input<typeof licenceSchema>) {
  return runAction(
    { schema: licenceSchema, permission: ["update", "users"] },
    input,
    async (d, actor) => {
      const licence = await db.$transaction(async (tx) => {
        const saved = id
          ? await tx.technicianLicence.update({ where: { id }, data: d })
          : await tx.technicianLicence.create({ data: d });
        await audit(tx, {
          userId: actor.id,
          action: id ? "UPDATE" : "CREATE",
          entityType: "LICENCE",
          entityId: saved.id,
          changes: d,
        });
        return saved;
      });
      revalidateTeam(licence.userId);
      return { id: licence.id };
    },
  );
}

export async function deleteLicence(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "users"] },
    input,
    async ({ id }, actor) => {
      const licence = await db.technicianLicence.findUnique({ where: { id } });
      if (!licence) throw new NotFoundError("Licence");
      await db.technicianLicence.delete({ where: { id } });
      await audit(db, {
        userId: actor.id,
        action: "DELETE",
        entityType: "LICENCE",
        entityId: id,
        changes: { number: licence.number },
      });
      revalidateTeam(licence.userId);
      return null;
    },
  );
}

/** Any signed-in user changing their own password. */
export async function changeOwnPassword(input: z.input<typeof changePasswordSchema>) {
  return runAction(
    { schema: changePasswordSchema },
    input,
    async ({ currentPassword, newPassword }, actor) => {
      const user = await db.user.findUnique({ where: { id: actor.id } });
      if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        throw new UserError("Your current password is incorrect.");
      }
      await db.user.update({
        where: { id: actor.id },
        data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      });
      await audit(db, {
        userId: actor.id,
        action: "PASSWORD",
        entityType: "USER",
        entityId: actor.id,
      });
      return null;
    },
  );
}
