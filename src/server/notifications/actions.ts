"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/server/action";

export async function markNotificationRead(input: { id: string }) {
  return runAction({ schema: z.object({ id: z.string().min(1) }) }, input, async ({ id }, user) => {
    await db.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/", "layout");
    return null;
  });
}

export async function markAllNotificationsRead() {
  return runAction({ schema: z.object({}) }, {}, async (_d, user) => {
    await db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/", "layout");
    return null;
  });
}
