import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

/** The singleton business settings row (created with defaults on first read). */
export const getSettings = cache(async () => {
  const existing = await db.businessSettings.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return db.businessSettings.create({ data: { id: "singleton" } });
});

export type BusinessSettingsRecord = Awaited<ReturnType<typeof getSettings>>;
