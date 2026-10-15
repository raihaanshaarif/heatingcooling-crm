import "server-only";
import { db } from "@/lib/db";
import { addMelbourneDays, startOfMelbourneMonth } from "@/lib/dates";
import { calendarState } from "@/server/google-calendar/queries";

export async function listTeam() {
  const monthStart = startOfMelbourneMonth();
  const users = await db.user.findMany({
    include: {
      licences: { orderBy: { expiresAt: "asc" } },
      _count: {
        select: {
          jobAssignments: {
            where: {
              job: { deletedAt: null, status: { in: ["SCHEDULED", "EN_ROUTE", "IN_PROGRESS"] } },
            },
          },
        },
      },
      timeEntries: { where: { startedAt: { gte: monthStart } }, select: { minutes: true } },
      googleCalendar: { select: { needsReconnect: true, lastError: true } },
    },
    orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
  });
  const soon = addMelbourneDays(new Date(), 30);
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    color: u.color,
    active: u.active,
    hourlyCostCents: u.hourlyCostCents,
    openJobs: u._count.jobAssignments,
    minutesThisMonth: u.timeEntries.reduce((s, t) => s + (t.minutes ?? 0), 0),
    licences: u.licences.map((l) => ({
      id: l.id,
      type: l.type,
      number: l.number,
      expiresAt: l.expiresAt,
    })),
    licenceAlert: u.licences.some((l) => l.expiresAt && l.expiresAt <= soon),
    calendar: u.googleCalendar ? calendarState(u.googleCalendar) : null,
  }));
}
export type TeamRow = Awaited<ReturnType<typeof listTeam>>[number];

export async function getTeamMember(id: string) {
  return db.user.findUnique({
    where: { id },
    include: {
      licences: { orderBy: { expiresAt: "asc" } },
      jobAssignments: {
        where: { job: { deletedAt: null } },
        include: {
          job: {
            select: {
              id: true,
              number: true,
              title: true,
              type: true,
              status: true,
              priority: true,
              scheduledStart: true,
            },
          },
        },
        orderBy: { job: { scheduledStart: "desc" } },
        take: 20,
      },
    },
  });
}
export type TeamMember = NonNullable<Awaited<ReturnType<typeof getTeamMember>>>;
