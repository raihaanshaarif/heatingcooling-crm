"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can, ForbiddenError } from "@/lib/permissions";
import { deleteFile, keyFromUrl, saveFile } from "@/lib/storage";
import {
  businessSettingsSchema,
  checklistTemplateSchema,
  emailTemplatesSchema,
  invoicingSettingsSchema,
  numberingSettingsSchema,
} from "@/lib/validations/settings";
import {
  NotFoundError,
  UserError,
  idSchema,
  runAction,
  toErrorResult,
  type ActionResult,
} from "@/server/action";
import { audit, diff } from "@/server/audit";
import { getSettings } from "@/server/settings";

function revalidateSettings() {
  revalidatePath("/", "layout");
}

async function updateSettings(section: string, data: Record<string, unknown>, userId: string) {
  const before = await getSettings();
  await db.$transaction(async (tx) => {
    await tx.businessSettings.update({ where: { id: "singleton" }, data });
    await audit(tx, {
      userId,
      action: "UPDATE",
      entityType: "SETTINGS",
      entityId: section,
      changes: diff(before, data),
    });
  });
  revalidateSettings();
  return null;
}

export async function saveBusinessSettings(input: z.input<typeof businessSettingsSchema>) {
  return runAction(
    { schema: businessSettingsSchema, permission: ["update", "settings"] },
    input,
    (d, user) => updateSettings("business", d, user.id),
  );
}

export async function saveInvoicingSettings(input: z.input<typeof invoicingSettingsSchema>) {
  return runAction(
    { schema: invoicingSettingsSchema, permission: ["update", "settings"] },
    input,
    (d, user) =>
      updateSettings(
        "invoicing",
        {
          ...d,
          defaultPaymentTermsDays: { ON_COMPLETION: 0, DAYS_7: 7, DAYS_14: 14, DAYS_30: 30 }[
            d.defaultPaymentTerms
          ],
        },
        user.id,
      ),
  );
}

export async function saveNumberingSettings(input: z.input<typeof numberingSettingsSchema>) {
  return runAction(
    { schema: numberingSettingsSchema, permission: ["update", "settings"] },
    input,
    (d, user) =>
      updateSettings(
        "numbering",
        {
          quotePrefix: d.quotePrefix.toUpperCase(),
          jobPrefix: d.jobPrefix.toUpperCase(),
          invoicePrefix: d.invoicePrefix.toUpperCase(),
          creditNotePrefix: d.creditNotePrefix.toUpperCase(),
        },
        user.id,
      ),
  );
}

export async function saveEmailTemplates(input: z.input<typeof emailTemplatesSchema>) {
  return runAction(
    { schema: emailTemplatesSchema, permission: ["update", "settings"] },
    input,
    (d, user) => updateSettings("emailTemplates", { emailTemplates: d }, user.id),
  );
}

const counterSchema = z.object({
  key: z.enum(["QUOTE", "JOB", "INVOICE", "CREDIT_NOTE"]),
  next: z.coerce.number().int().min(1).max(9_999_999),
});

/** Set the next document number, e.g. to continue on from a previous system. Numbers can only go up. */
export async function setNextNumber(input: z.input<typeof counterSchema>) {
  return runAction(
    { schema: counterSchema, permission: ["update", "settings"] },
    input,
    async ({ key, next }, user) => {
      const current = await db.counter.findUnique({ where: { key } });
      if (current && next <= current.value)
        throw new UserError(
          `Numbers can only move forward. The last ${key.toLowerCase().replace("_", " ")} number used was ${current.value}.`,
        );
      await db.counter.upsert({
        where: { key },
        create: { id: `counter_${key.toLowerCase()}`, key, value: next - 1 },
        update: { value: next - 1 },
      });
      await audit(db, {
        userId: user.id,
        action: "UPDATE",
        entityType: "SETTINGS",
        entityId: "numbering",
        changes: { [key]: { from: current?.value ?? 0, to: next - 1 } },
      });
      revalidateSettings();
      return null;
    },
  );
}

export async function uploadLogo(formData: FormData): Promise<ActionResult<{ url: string }>> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "Your session has expired." };
    if (!can(user, "update", "settings")) throw new ForbiddenError();
    const file = formData.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose an image.");
    if (!["image/png", "image/jpeg"].includes(file.type))
      throw new UserError("Use a PNG or JPG logo (it's printed on PDFs).");
    if (file.size > 2 * 1024 * 1024) throw new UserError("Logo must be under 2 MB.");
    const stored = await saveFile({
      folder: "branding",
      fileName: file.name,
      contentType: file.type,
      body: Buffer.from(await file.arrayBuffer()),
      isPublic: true,
    });
    const before = await getSettings();
    await db.businessSettings.update({ where: { id: "singleton" }, data: { logoUrl: stored.url } });
    const oldKey = before.logoUrl ? keyFromUrl(before.logoUrl) : null;
    if (oldKey) await deleteFile(oldKey).catch(() => undefined);
    await audit(db, {
      userId: user.id,
      action: "UPDATE",
      entityType: "SETTINGS",
      entityId: "logo",
      changes: { logoUrl: stored.url },
    });
    revalidateSettings();
    return { ok: true, data: { url: stored.url } };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function removeLogo() {
  return runAction(
    { schema: z.object({}), permission: ["update", "settings"] },
    {},
    async (_d, user) => {
      const before = await getSettings();
      await db.businessSettings.update({ where: { id: "singleton" }, data: { logoUrl: null } });
      const key = before.logoUrl ? keyFromUrl(before.logoUrl) : null;
      if (key) await deleteFile(key).catch(() => undefined);
      await audit(db, {
        userId: user.id,
        action: "UPDATE",
        entityType: "SETTINGS",
        entityId: "logo",
        changes: { logoUrl: null },
      });
      revalidateSettings();
      return null;
    },
  );
}

export async function saveChecklistTemplate(input: z.input<typeof checklistTemplateSchema>) {
  return runAction(
    { schema: checklistTemplateSchema, permission: ["update", "settings"] },
    input,
    async ({ id, ...d }, user) => {
      const saved = id
        ? await db.jobChecklistTemplate.update({ where: { id }, data: d })
        : await db.jobChecklistTemplate.create({ data: d });
      await audit(db, {
        userId: user.id,
        action: id ? "UPDATE" : "CREATE",
        entityType: "CHECKLIST_TEMPLATE",
        entityId: saved.id,
        changes: d,
      });
      revalidatePath("/settings");
      return { id: saved.id };
    },
  );
}

export async function deleteChecklistTemplate(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "settings"] },
    input,
    async ({ id }, user) => {
      const t = await db.jobChecklistTemplate.findUnique({ where: { id } });
      if (!t) throw new NotFoundError("Template");
      await db.jobChecklistTemplate.delete({ where: { id } });
      await audit(db, {
        userId: user.id,
        action: "DELETE",
        entityType: "CHECKLIST_TEMPLATE",
        entityId: id,
        changes: { name: t.name },
      });
      revalidatePath("/settings");
      return null;
    },
  );
}
