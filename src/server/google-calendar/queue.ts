import "server-only";
import { after } from "next/server";
import type { GoogleCalendarTaskKind, Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { startOfMelbourneDay } from "@/lib/dates";
import { affectedUsers } from "@/lib/google-calendar/events";
import { isGoogleCalendarConfigured } from "./connection";

type Client = Tx | typeof db;

interface TaskInput {
  kind: GoogleCalendarTaskKind;
  userId: string;
  jobId?: string | null;
  label: string;
  force?: boolean;
}

/**
 * Add a task to the calendar outbox (normally inside the transaction that changed the job).
 * A task still waiting for the same user + job (or the same user's resync) is reused, since
 * the worker always reads the job's current state: two quick edits cost one API call.
 */
async function enqueueTask(client: Client, input: TaskInput) {
  const reset = {
    status: "PENDING" as const,
    attempts: 0,
    nextAttemptAt: new Date(),
    lastError: null,
    completedAt: null,
    label: input.label,
  };
  const existing = await client.googleCalendarTask.findFirst({
    where: {
      kind: input.kind,
      userId: input.userId,
      jobId: input.jobId ?? null,
      status: { in: ["PENDING", "FAILED"] },
    },
    orderBy: { createdAt: "asc" },
  });
  if (existing)
    await client.googleCalendarTask.update({
      where: { id: existing.id },
      data: { ...reset, force: existing.force || !!input.force },
    });
  else
    await client.googleCalendarTask.create({
      data: {
        ...reset,
        kind: input.kind,
        userId: input.userId,
        jobId: input.jobId ?? null,
        force: !!input.force,
      },
    });
}

/**
 * A job changed (scheduled, moved, edited, reassigned, status, cancelled, deleted): queue
 * an update for everyone it's assigned to and everyone who still has an event for it (the
 * technician it was taken off). Only users who connected Google Calendar get a task.
 */
export async function queueJobCalendarSync(client: Client, jobId: string): Promise<number> {
  if (!isGoogleCalendarConfigured()) return 0;
  const [job, assignments, events] = await Promise.all([
    client.job.findUnique({ where: { id: jobId }, select: { number: true } }),
    client.jobAssignment.findMany({ where: { jobId }, select: { userId: true } }),
    client.googleCalendarEvent.findMany({ where: { jobId }, select: { userId: true } }),
  ]);
  if (!job) return 0;
  const users = affectedUsers(
    assignments.map((a) => a.userId),
    events.map((e) => e.userId),
  );
  if (users.length === 0) return 0;
  const connected = await client.googleCalendarConnection.findMany({
    where: { userId: { in: users }, needsReconnect: false },
    select: { userId: true },
  });
  for (const { userId } of connected)
    await enqueueTask(client, { kind: "SYNC_JOB", userId, jobId, label: job.number });
  return connected.length;
}

/** Client or site details changed: refresh the events of their upcoming jobs. */
export async function queueCalendarSyncForJobs(client: Client, where: Prisma.JobWhereInput) {
  if (!isGoogleCalendarConfigured()) return 0;
  const jobs = await client.job.findMany({
    where: {
      ...where,
      scheduledStart: { gte: startOfMelbourneDay() },
      OR: [
        { calendarEvents: { some: {} } },
        { assignments: { some: { user: { googleCalendar: { isNot: null } } } } },
      ],
    },
    select: { id: true },
    take: 200,
  });
  let queued = 0;
  for (const job of jobs) queued += await queueJobCalendarSync(client, job.id);
  return queued;
}

/** Full resync of a user's upcoming jobs (button, after connecting, daily cron). */
export function queueUserResync(client: Client, userId: string, force: boolean) {
  return enqueueTask(client, {
    kind: "RESYNC_USER",
    userId,
    label: force ? "Full resync" : "Daily check",
    force,
  });
}

/**
 * Process the outbox after the response has been sent (non-blocking). Safe to call when
 * Google Calendar isn't set up or nobody connected: the run returns straight away.
 */
export function kickCalendarSync() {
  if (!isGoogleCalendarConfigured()) return;
  try {
    after(async () => {
      try {
        const { processCalendarQueue } = await import("./sync");
        await processCalendarQueue({ maxTasks: 25, timeBudgetMs: 25_000 });
      } catch (error) {
        console.error("[google-calendar] background sync failed", error);
      }
    });
  } catch {
    // Outside a request (scripts, tests): the cron or Resync my calendar will pick it up.
  }
}
