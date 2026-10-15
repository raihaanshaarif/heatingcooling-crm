import "server-only";
import type { GoogleCalendarConnection, GoogleCalendarTask, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { addMelbourneDays, startOfMelbourneDay } from "@/lib/dates";
import { STALE_LOCK_MS, nextStateAfterFailure, type SyncFailure } from "@/lib/outbox";
import {
  GoogleApiError,
  GoogleRateLimitError,
  type GoogleCalendarApi,
} from "@/lib/google-calendar/client";
import {
  CALENDAR_STATUSES,
  RESYNC_DAYS,
  buildEventPayload,
  calendarEventId,
  diffCalendarEvents,
  freshCalendarEventId,
  hashEvent,
  shouldHaveEvent,
  type CalendarJob,
  type CalendarOp,
  type DesiredEvent,
  type ExistingEvent,
} from "@/lib/google-calendar/events";
import { GoogleAuthError } from "@/lib/google-calendar/oauth";
import { appUrl } from "@/lib/utils";
import { getCalendarApi } from "./connection";
import { queueUserResync } from "./queue";

const jobInclude = {
  client: { select: { name: true, phone: true, altPhone: true } },
  property: {
    select: {
      addressLine1: true,
      addressLine2: true,
      suburb: true,
      state: true,
      postcode: true,
      accessNotes: true,
      parkingNotes: true,
      petNotes: true,
      keyInfo: true,
    },
  },
  assignments: {
    select: { userId: true, user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.JobInclude;

type JobRow = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

function toCalendarJob(j: JobRow): CalendarJob {
  return {
    id: j.id,
    number: j.number,
    title: j.title,
    type: j.type,
    status: j.status,
    priority: j.priority,
    description: j.description,
    scheduledStart: j.scheduledStart,
    scheduledEnd: j.scheduledEnd,
    estimatedMinutes: j.estimatedMinutes,
    deletedAt: j.deletedAt,
    client: j.client,
    property: j.property,
    assignees: j.assignments.map((a) => ({ userId: a.userId, name: a.user.name })),
  };
}

interface Ctx {
  api: GoogleCalendarApi;
  conn: GoogleCalendarConnection;
  userId: string;
  role: Role;
}

function desiredFor(ctx: Ctx, job: CalendarJob): DesiredEvent {
  const body = buildEventPayload(job, { userId: ctx.userId, role: ctx.role }, appUrl());
  return {
    jobId: job.id,
    label: job.number,
    body,
    hash: hashEvent(body),
    startsAt: job.scheduledStart!,
  };
}

const isGone = (e: unknown) =>
  e instanceof GoogleApiError && (e.status === 404 || e.status === 410);
const isConflict = (e: unknown) => e instanceof GoogleApiError && e.status === 409;

async function saveLink(ctx: Ctx, event: DesiredEvent, googleEventId: string) {
  const data = {
    calendarId: ctx.conn.calendarId,
    googleEventId,
    payloadHash: event.hash,
    startsAt: event.startsAt,
    syncedAt: new Date(),
  };
  await db.googleCalendarEvent.upsert({
    where: { userId_jobId: { userId: ctx.userId, jobId: event.jobId } },
    create: { userId: ctx.userId, jobId: event.jobId, ...data },
    update: data,
  });
}

/** Insert with a fresh id when Google says the old event is gone for good. */
async function recreate(ctx: Ctx, event: DesiredEvent) {
  const created = await ctx.api.insertEvent(ctx.conn.calendarId, {
    ...event.body,
    id: freshCalendarEventId(),
  });
  return created.id;
}

/** Apply one operation and record it, so a run that stops half way resumes cleanly. */
async function applyOp(ctx: Ctx, op: CalendarOp): Promise<void> {
  const cal = ctx.conn.calendarId;
  if (op.type === "delete") {
    try {
      await ctx.api.deleteEvent(op.calendarId, op.googleEventId);
    } catch (error) {
      if (!isGone(error)) throw error; // already deleted in Google: fine
    }
    await db.googleCalendarEvent.deleteMany({
      where: { userId: ctx.userId, jobId: op.jobId, googleEventId: op.googleEventId },
    });
    return;
  }
  if (op.type === "create") {
    const id = calendarEventId(ctx.userId, op.event.jobId);
    let eventId = id;
    try {
      eventId = (await ctx.api.insertEvent(cal, { ...op.event.body, id })).id || id;
    } catch (error) {
      if (!isConflict(error)) throw error;
      // The id exists: an earlier attempt got through, or the event was deleted before
      // (deleted events keep their id). Replacing it brings it back up to date.
      try {
        await ctx.api.updateEvent(cal, id, op.event.body);
      } catch (inner) {
        if (!isGone(inner)) throw inner;
        eventId = await recreate(ctx, op.event);
      }
    }
    await saveLink(ctx, op.event, eventId);
    return;
  }
  let eventId = op.googleEventId;
  try {
    await ctx.api.updateEvent(cal, op.googleEventId, op.event.body);
  } catch (error) {
    if (!isGone(error)) throw error;
    eventId = await recreate(ctx, op.event);
  }
  await saveLink(ctx, op.event, eventId);
}

async function applyOps(ctx: Ctx, ops: CalendarOp[]) {
  for (const op of ops) await applyOp(ctx, op);
  return ops;
}

function summarise(ops: CalendarOp[]): string | null {
  if (ops.length === 0) return "Already up to date";
  const count = (t: CalendarOp["type"]) => ops.filter((o) => o.type === t).length;
  const parts = [
    [count("create"), "added"],
    [count("update"), "updated"],
    [count("delete"), "removed"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, w]) => `${n} ${w}`)
    .join(", ");
}

/** Bring one job's event in one user's calendar up to date. */
async function syncJobForUser(ctx: Ctx, jobId: string) {
  const row = await db.job.findUnique({ where: { id: jobId }, include: jobInclude });
  const link = await db.googleCalendarEvent.findUnique({
    where: { userId_jobId: { userId: ctx.userId, jobId } },
  });
  const job = row ? toCalendarJob(row) : null;
  const desired = job && shouldHaveEvent(job, ctx.userId) ? [desiredFor(ctx, job)] : [];
  const existing: ExistingEvent[] = link ? [link] : [];
  return applyOps(ctx, diffCalendarEvents(desired, existing, { calendarId: ctx.conn.calendarId }));
}

/**
 * Full resync of the user's next RESYNC_DAYS days: create what's missing, update what
 * changed (everything when forced), delete events for jobs they're no longer on.
 */
async function resyncUser(ctx: Ctx, force: boolean) {
  const from = startOfMelbourneDay();
  const to = addMelbourneDays(from, RESYNC_DAYS);
  const rows = await db.job.findMany({
    where: {
      deletedAt: null,
      status: { in: CALENDAR_STATUSES },
      scheduledStart: { gte: from, lt: to },
      assignments: { some: { userId: ctx.userId } },
    },
    include: jobInclude,
    orderBy: { scheduledStart: "asc" },
  });
  const desired = rows.map(toCalendarJob).map((j) => desiredFor(ctx, j));
  const wanted = new Set(desired.map((d) => d.jobId));
  const links = await db.googleCalendarEvent.findMany({
    where: {
      userId: ctx.userId,
      OR: [{ startsAt: { gte: from } }, { startsAt: null }, { jobId: { in: [...wanted] } }],
    },
  });
  // An event for a job that's still the user's but moved beyond the window stays as is.
  const outside = links.filter((l) => !wanted.has(l.jobId)).map((l) => l.jobId);
  const stillTheirs = new Set(
    outside.length
      ? (await db.job.findMany({ where: { id: { in: outside } }, include: jobInclude }))
          .map(toCalendarJob)
          .filter((j) => shouldHaveEvent(j, ctx.userId))
          .map((j) => j.id)
      : [],
  );
  const existing = links.filter((l) => !stillTheirs.has(l.jobId));
  return applyOps(
    ctx,
    diffCalendarEvents(desired, existing, { calendarId: ctx.conn.calendarId, force }),
  );
}

/** A dead Google grant: no point retrying until the user reconnects. */
const RECONNECT_MESSAGE = "Google Calendar needs to be connected again (My account).";

function toFailure(error: unknown): SyncFailure {
  if (error instanceof GoogleRateLimitError)
    return { message: error.message, retryable: true, retryAfterMs: error.retryAfterMs };
  if (error instanceof GoogleApiError)
    return { message: error.message, retryable: error.retryable };
  if (error instanceof GoogleAuthError)
    return {
      message: error.reconnect ? RECONNECT_MESSAGE : error.message,
      retryable: !error.reconnect,
    };
  console.error("[google-calendar] unexpected sync error", error);
  return { message: error instanceof Error ? error.message : String(error), retryable: true };
}

async function runTask(task: GoogleCalendarTask): Promise<string | null> {
  const client = await getCalendarApi(task.userId);
  if (!client) return "Google Calendar isn't connected for this user; skipped";
  if (client.conn.needsReconnect) throw new GoogleAuthError(RECONNECT_MESSAGE, true);
  const user = await db.user.findUnique({ where: { id: task.userId }, select: { role: true } });
  if (!user) return "User no longer exists; skipped";
  const ctx: Ctx = { ...client, userId: task.userId, role: user.role };
  const ops =
    task.kind === "SYNC_JOB" && task.jobId
      ? await syncJobForUser(ctx, task.jobId)
      : await resyncUser(ctx, task.force);
  return summarise(ops);
}

export interface CalendarRunResult {
  ran: boolean;
  reason?: string;
  processed: number;
  succeeded: number;
  failed: number;
  rateLimited: boolean;
  remaining: number;
  notes: string[];
}

let running = false;

/**
 * Work through due tasks oldest first, one at a time. force=true also runs tasks waiting for
 * a retry; userId limits the run to one user's tasks (Resync my calendar).
 */
export async function processCalendarQueue({
  maxTasks = 50,
  timeBudgetMs = 25_000,
  force = false,
  userId,
}: {
  maxTasks?: number;
  timeBudgetMs?: number;
  force?: boolean;
  userId?: string;
} = {}): Promise<CalendarRunResult> {
  const result: CalendarRunResult = {
    ran: false,
    processed: 0,
    succeeded: 0,
    failed: 0,
    rateLimited: false,
    remaining: 0,
    notes: [],
  };
  if (running) return { ...result, reason: "A calendar sync is already running." };
  running = true;
  result.ran = true;
  const started = Date.now();
  try {
    await db.googleCalendarTask.updateMany({
      where: { status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      data: { status: "PENDING", lockedAt: null },
    });
    const seen: string[] = [];
    const scope = userId ? { userId } : {};
    while (result.processed < maxTasks && Date.now() - started < timeBudgetMs) {
      const task = await db.googleCalendarTask.findFirst({
        where: {
          ...scope,
          status: "PENDING",
          id: { notIn: seen },
          ...(force ? {} : { nextAttemptAt: { lte: new Date() } }),
        },
        orderBy: { createdAt: "asc" },
      });
      if (!task) break;
      seen.push(task.id);
      const claimed = await db.googleCalendarTask.updateMany({
        where: { id: task.id, status: "PENDING" },
        data: { status: "PROCESSING", lockedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      result.processed += 1;
      try {
        const note = await runTask(task);
        await db.googleCalendarTask.update({
          where: { id: task.id },
          data: {
            status: "DONE",
            attempts: task.attempts + 1,
            lastError: note,
            completedAt: new Date(),
            lockedAt: null,
          },
        });
        await db.googleCalendarConnection.updateMany({
          where: { userId: task.userId },
          data: { lastSyncAt: new Date(), lastError: null },
        });
        if (note) result.notes.push(`${task.label}: ${note}`);
        result.succeeded += 1;
      } catch (error) {
        const failure = toFailure(error);
        const { stopRun, ...next } = nextStateAfterFailure(task, failure);
        await db.googleCalendarTask.update({
          where: { id: task.id },
          data: { ...next, lastError: next.lastError.slice(0, 2000), lockedAt: null },
        });
        await db.googleCalendarConnection.updateMany({
          where: { userId: task.userId },
          data: { lastError: `${task.label}: ${failure.message}`.slice(0, 1000) },
        });
        result.failed += 1;
        result.notes.push(`${task.label}: ${failure.message}`);
        if (stopRun) {
          result.rateLimited = true;
          break;
        }
      }
    }
    result.remaining = await db.googleCalendarTask.count({
      where: { ...scope, status: "PENDING" },
    });
  } finally {
    running = false;
  }
  if (result.processed) console.info("[google-calendar] sync run", result);
  return result;
}

/**
 * Daily cron: check every connected user's next RESYNC_DAYS days (only changed events cost an
 * API call, so this also picks up client / site edits) and send whatever is still waiting.
 */
export async function runCalendarCron() {
  const connections = await db.googleCalendarConnection.findMany({
    where: { needsReconnect: false },
    select: { userId: true },
  });
  if (connections.length === 0) return { skipped: "nobody connected" };
  for (const c of connections) await queueUserResync(db, c.userId, false);
  return processCalendarQueue({ maxTasks: 500, timeBudgetMs: 25_000 });
}

/**
 * Before disconnecting: delete the user's upcoming CoolOps events from their calendar (past
 * ones stay as a record). Best effort within a time budget; returns how many went.
 */
export async function removeUpcomingEvents(userId: string, timeBudgetMs = 20_000) {
  const client = await getCalendarApi(userId);
  if (!client || client.conn.needsReconnect) return { removed: 0, left: 0 };
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  const ctx: Ctx = { ...client, userId, role: user?.role ?? "TECHNICIAN" };
  const links = await db.googleCalendarEvent.findMany({
    where: { userId, OR: [{ startsAt: { gte: startOfMelbourneDay() } }, { startsAt: null }] },
  });
  const started = Date.now();
  let removed = 0;
  for (const l of links) {
    if (Date.now() - started > timeBudgetMs) break;
    try {
      await applyOp(ctx, {
        type: "delete",
        jobId: l.jobId,
        googleEventId: l.googleEventId,
        calendarId: l.calendarId,
      });
      removed += 1;
    } catch (error) {
      console.error("[google-calendar] couldn't remove event on disconnect", error);
      break;
    }
  }
  return { removed, left: links.length - removed };
}
