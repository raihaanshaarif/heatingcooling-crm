import "server-only";
import type { ActivityType, EntityType, Prisma, Role } from "@prisma/client";
import { db, type Tx } from "@/lib/db";

type Client = Tx | typeof db;

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

/** Field-level diff of `after` against `before` (only keys present in `after`). */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    const from = before?.[key];
    const a = JSON.stringify(from ?? null);
    const b = JSON.stringify(to ?? null);
    if (a !== b) changes[key] = { from: from ?? null, to: to ?? null };
  }
  return changes;
}

export async function audit(
  client: Client,
  entry: {
    userId: string | null;
    action: string;
    entityType: EntityType;
    entityId: string;
    changes?: unknown;
  },
) {
  await client.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      changes: toJson(entry.changes),
    },
  });
}

export async function logActivity(
  client: Client,
  entry: {
    entityType: EntityType;
    entityId: string;
    type?: ActivityType;
    body: string;
    userId?: string | null;
  },
) {
  await client.activity.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      type: entry.type ?? "SYSTEM",
      body: entry.body,
      userId: entry.userId ?? null,
    },
  });
}

export async function notifyRoles(
  client: Client,
  roles: Role[],
  notification: { title: string; body?: string; link?: string },
) {
  const users = await client.user.findMany({
    where: { role: { in: roles }, active: true },
    select: { id: true },
  });
  await notifyUsers(
    client,
    users.map((u) => u.id),
    notification,
  );
}

export async function notifyUsers(
  client: Client,
  userIds: string[],
  notification: { title: string; body?: string; link?: string },
) {
  if (userIds.length === 0) return;
  await client.notification.createMany({
    data: [...new Set(userIds)].map((userId) => ({
      userId,
      title: notification.title,
      body: notification.body ?? null,
      link: notification.link ?? null,
    })),
  });
}
