import "server-only";
import { db } from "@/lib/db";
import { startOfMelbourneDay } from "@/lib/dates";
import { getGoogleConfig } from "./connection";

export type CalendarBadge = "connected" | "error" | "reconnect";

export function calendarState(c: {
  needsReconnect: boolean;
  lastError: string | null;
}): CalendarBadge {
  return c.needsReconnect ? "reconnect" : c.lastError ? "error" : "connected";
}

/** My account → Google Calendar card. */
export async function getMyCalendarStatus(userId: string) {
  const config = getGoogleConfig();
  const conn = await db.googleCalendarConnection.findUnique({ where: { userId } });
  if (!conn) return { configured: config.configured, connection: null };
  const [upcoming, pending, failed] = await Promise.all([
    db.googleCalendarEvent.count({ where: { userId, startsAt: { gte: startOfMelbourneDay() } } }),
    db.googleCalendarTask.count({ where: { userId, status: { in: ["PENDING", "PROCESSING"] } } }),
    db.googleCalendarTask.count({ where: { userId, status: "FAILED" } }),
  ]);
  return {
    configured: config.configured,
    connection: {
      googleEmail: conn.googleEmail,
      calendarId: conn.calendarId,
      connectedAt: conn.createdAt,
      lastSyncAt: conn.lastSyncAt,
      lastError: conn.lastError,
      needsReconnect: conn.needsReconnect,
      state: calendarState(conn),
      upcoming,
      pending,
      failed,
    },
  };
}
export type MyCalendarStatus = Awaited<ReturnType<typeof getMyCalendarStatus>>;

/** Integrations page (admin): who connected, and any problems. */
export async function getCalendarOverview() {
  const config = getGoogleConfig();
  const [connections, failedByUser, pendingByUser, eventsByUser] = await Promise.all([
    db.googleCalendarConnection.findMany({
      include: { user: { select: { id: true, name: true, role: true, active: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    db.googleCalendarTask.groupBy({ by: ["userId"], where: { status: "FAILED" }, _count: true }),
    db.googleCalendarTask.groupBy({
      by: ["userId"],
      where: { status: { in: ["PENDING", "PROCESSING"] } },
      _count: true,
    }),
    db.googleCalendarEvent.groupBy({
      by: ["userId"],
      where: { startsAt: { gte: startOfMelbourneDay() } },
      _count: true,
    }),
  ]);
  const count = (rows: { userId: string; _count: number }[], userId: string) =>
    rows.find((r) => r.userId === userId)?._count ?? 0;
  const users = connections.map((c) => ({
    userId: c.userId,
    name: c.user.name,
    role: c.user.role,
    active: c.user.active,
    googleEmail: c.googleEmail,
    lastSyncAt: c.lastSyncAt,
    lastError: c.lastError,
    state: calendarState(c),
    upcoming: count(eventsByUser, c.userId),
    pending: count(pendingByUser, c.userId),
    failed: count(failedByUser, c.userId),
  }));
  const totalUsers = await db.user.count({ where: { active: true } });
  return {
    configured: config.configured,
    missing: config.configured ? [] : config.missing,
    users,
    totalUsers,
    failed: users.reduce((s, u) => s + u.failed, 0),
  };
}

/** Team page badges: userId → calendar state. */
export async function getCalendarBadges(): Promise<Record<string, CalendarBadge>> {
  const rows = await db.googleCalendarConnection.findMany({
    select: { userId: true, needsReconnect: true, lastError: true },
  });
  return Object.fromEntries(rows.map((r) => [r.userId, calendarState(r)]));
}
