"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EntityType } from "@prisma/client";
import { db } from "@/lib/db";
import { requiredText } from "@/lib/validations/common";
import { runAction } from "@/server/action";
import { logActivity } from "@/server/audit";

const noteSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().min(1),
  type: z.enum(["NOTE", "CALL", "EMAIL", "SMS"]).default("NOTE"),
  body: requiredText("Note", 5000),
  path: z.string().startsWith("/").optional(),
});

/** Add a note / call log to any record's timeline. */
export async function addNote(input: z.input<typeof noteSchema>) {
  const resource =
    input.entityType === "LEAD"
      ? "leads"
      : input.entityType === "JOB"
        ? "jobs"
        : input.entityType === "QUOTE"
          ? "quotes"
          : input.entityType === "INVOICE"
            ? "invoices"
            : "clients";
  return runAction(
    { schema: noteSchema, permission: ["update", resource] },
    input,
    async (data, user) => {
      await logActivity(db, {
        entityType: data.entityType,
        entityId: data.entityId,
        type: data.type,
        body: data.body,
        userId: user.id,
      });
      if (data.path) revalidatePath(data.path);
      return null;
    },
  );
}
