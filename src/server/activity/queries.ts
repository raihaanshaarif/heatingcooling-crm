import "server-only";
import type { ActivityType, EntityType } from "@prisma/client";
import { db } from "@/lib/db";

export interface TimelineEntry {
  id: string;
  type: ActivityType | "PAYMENT";
  entityType: EntityType;
  entityId: string;
  body: string;
  userName: string | null;
  createdAt: Date;
}

export async function getTimeline(
  refs: { entityType: EntityType; ids: string[] }[],
  limit = 100,
): Promise<TimelineEntry[]> {
  const or = refs
    .filter((r) => r.ids.length > 0)
    .map((r) => ({ entityType: r.entityType, entityId: { in: r.ids } }));
  if (or.length === 0) return [];
  const rows = await db.activity.findMany({
    where: { OR: or },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    entityType: r.entityType,
    entityId: r.entityId,
    body: r.body,
    userName: r.user?.name ?? null,
    createdAt: r.createdAt,
  }));
}
