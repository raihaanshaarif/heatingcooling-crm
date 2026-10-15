/**
 * Pure logic for the Google Calendar sync (unit-tested): which jobs belong in a user's
 * calendar, what the event looks like, and how to turn "what should be there" plus "what we
 * put there last time" into create / update / delete operations.
 */
import { createHash, randomBytes } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import type { JobStatus, JobType, Priority, Role } from "@prisma/client";
import { TIMEZONE } from "@/lib/dates";
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import { formatAddress, formatPhoneAU } from "@/lib/utils";

/** Jobs in these statuses are on the calendar (when they have a time). */
export const CALENDAR_STATUSES: JobStatus[] = [
  "SCHEDULED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "INVOICED",
];

/** How far ahead "Resync my calendar" and the daily cron look. */
export const RESYNC_DAYS = 60;

const DEFAULT_MINUTES = 120;
const MAX_NOTES = 1500;

export interface CalendarJob {
  id: string;
  number: string;
  title: string;
  type: JobType;
  status: JobStatus;
  priority: Priority;
  description: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  estimatedMinutes: number | null;
  deletedAt: Date | null;
  client: { name: string; phone: string | null; altPhone: string | null };
  property: {
    addressLine1: string;
    addressLine2: string | null;
    suburb: string;
    state: string;
    postcode: string;
    accessNotes: string | null;
    parkingNotes: string | null;
    petNotes: string | null;
    keyInfo: string | null;
  } | null;
  assignees: { userId: string; name: string }[];
}

export interface CalendarOwner {
  userId: string;
  role: Role;
}

export interface EventTime {
  dateTime: string;
  timeZone: string;
}

export interface GoogleEventBody {
  summary: string;
  location?: string;
  description: string;
  start: EventTime;
  end: EventTime;
  status: "confirmed";
  source: { title: string; url: string };
  reminders: { useDefault: true };
  extendedProperties: { private: { coolopsJobId: string; coolopsJobNumber: string } };
}

/** Should this user have an event for this job? Assigned, scheduled, not cancelled/deleted. */
export function shouldHaveEvent(job: CalendarJob, userId: string): boolean {
  return (
    !job.deletedAt &&
    !!job.scheduledStart &&
    CALENDAR_STATUSES.includes(job.status) &&
    job.assignees.some((a) => a.userId === userId)
  );
}

/** Melbourne wall-clock time with its UTC offset, e.g. 2026-01-15T09:00:00+11:00. */
export function melbourneEventTime(value: Date): EventTime {
  return {
    dateTime: formatInTimeZone(value, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    timeZone: TIMEZONE,
  };
}

export function eventEnd(
  job: Pick<CalendarJob, "scheduledStart" | "scheduledEnd" | "estimatedMinutes">,
) {
  const start = job.scheduledStart!;
  if (job.scheduledEnd && job.scheduledEnd > start) return job.scheduledEnd;
  const minutes =
    job.estimatedMinutes && job.estimatedMinutes > 0 ? job.estimatedMinutes : DEFAULT_MINUTES;
  return new Date(start.getTime() + minutes * 60_000);
}

export function eventSummary(job: Pick<CalendarJob, "number" | "title" | "status" | "client">) {
  const prefix =
    job.status === "COMPLETED" || job.status === "INVOICED"
      ? "✓ "
      : job.status === "ON_HOLD"
        ? "On hold · "
        : "";
  return `${prefix}${job.number} · ${job.title} · ${job.client.name}`;
}

/** Technicians open jobs in My jobs; office and admin on the job page. */
export function jobLink(appUrl: string, jobId: string, role: Role) {
  const base = appUrl.replace(/\/$/, "");
  return `${base}${role === "TECHNICIAN" ? "/my-jobs" : "/jobs"}/${jobId}`;
}

/** Plain text (Google shows it as is). Never includes prices. */
export function eventDescription(job: CalendarJob, owner: CalendarOwner, link: string): string {
  const lines: string[] = [`${job.number} · ${JOB_TYPE_LABELS[job.type]}`];
  const phones = [job.client.phone, job.client.altPhone]
    .filter((p): p is string => !!p)
    .map(formatPhoneAU)
    .join(" / ");
  lines.push(`Client: ${job.client.name}${phones ? ` · ${phones}` : ""}`);
  if (job.property) lines.push(`Site: ${formatAddress(job.property)}`);
  if (job.priority === "HIGH" || job.priority === "EMERGENCY")
    lines.push(`Priority: ${PRIORITY_LABELS[job.priority]}`);
  if (job.status !== "SCHEDULED") lines.push(`Status: ${JOB_STATUS_LABELS[job.status]}`);
  const others = job.assignees.filter((a) => a.userId !== owner.userId).map((a) => a.name);
  if (others.length) lines.push(`Also on this job: ${others.join(", ")}`);

  const site = job.property
    ? ([
        ["Access", job.property.accessNotes],
        ["Parking", job.property.parkingNotes],
        ["Pets", job.property.petNotes],
        ["Keys", job.property.keyInfo],
      ] as const)
    : [];
  const siteLines = site.filter(([, v]) => v?.trim()).map(([k, v]) => `${k}: ${v!.trim()}`);
  if (siteLines.length) lines.push("", ...siteLines);

  const notes = job.description?.trim();
  if (notes)
    lines.push(
      "",
      "Notes:",
      notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES - 1).trimEnd()}…` : notes,
    );
  lines.push("", `Open in CoolOps: ${link}`);
  return lines.join("\n");
}

export function buildEventPayload(
  job: CalendarJob,
  owner: CalendarOwner,
  appUrl: string,
): GoogleEventBody {
  if (!job.scheduledStart) throw new Error(`${job.number} has no scheduled time`);
  const link = jobLink(appUrl, job.id, owner.role);
  const location = job.property ? formatAddress(job.property) : "";
  return {
    summary: eventSummary(job),
    ...(location ? { location } : {}),
    description: eventDescription(job, owner, link),
    start: melbourneEventTime(job.scheduledStart),
    end: melbourneEventTime(eventEnd(job)),
    status: "confirmed",
    source: { title: `CoolOps ${job.number}`, url: link },
    reminders: { useDefault: true },
    extendedProperties: { private: { coolopsJobId: job.id, coolopsJobNumber: job.number } },
  };
}

export function hashEvent(body: GoogleEventBody): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
}

/**
 * Google event ids may only use base32hex characters (0-9, a-v), 5–1024 long. The first id
 * for a job in a user's calendar is derived from both ids, so a create that is retried after
 * a timeout hits 409 instead of making a second event.
 */
export function calendarEventId(userId: string, jobId: string): string {
  return `coolops${createHash("sha256").update(`${userId}:${jobId}`).digest("hex").slice(0, 32)}`;
}

/** A new id for re-creating an event that Google says is gone for good. */
export function freshCalendarEventId(): string {
  return `coolops${randomBytes(16).toString("hex")}`;
}

// ─── Diffing ────────────────────────────────────────────────────────────────

export interface DesiredEvent {
  jobId: string;
  label: string;
  body: GoogleEventBody;
  hash: string;
  startsAt: Date;
}

export interface ExistingEvent {
  jobId: string;
  googleEventId: string;
  calendarId: string;
  payloadHash: string;
}

export type CalendarOp =
  | { type: "create"; event: DesiredEvent }
  | { type: "update"; event: DesiredEvent; googleEventId: string }
  | { type: "delete"; jobId: string; googleEventId: string; calendarId: string };

/**
 * What to do to make the calendar match. `existing` should cover every event we made that
 * could need removing (for one job: its row for this user; for a full resync: the user's
 * upcoming events). Events that already match are left alone unless `force` (full resync,
 * which also repairs changes made by hand in Google).
 */
export function diffCalendarEvents(
  desired: DesiredEvent[],
  existing: ExistingEvent[],
  { calendarId, force = false }: { calendarId: string; force?: boolean },
): CalendarOp[] {
  const ops: CalendarOp[] = [];
  const byJob = new Map(existing.map((e) => [e.jobId, e]));
  const wanted = new Set(desired.map((d) => d.jobId));
  for (const e of existing) {
    if (!wanted.has(e.jobId))
      ops.push({
        type: "delete",
        jobId: e.jobId,
        googleEventId: e.googleEventId,
        calendarId: e.calendarId,
      });
  }
  for (const d of desired) {
    const current = byJob.get(d.jobId);
    if (!current) ops.push({ type: "create", event: d });
    else if (current.calendarId !== calendarId) {
      // The user switched calendars: move the event.
      ops.push({
        type: "delete",
        jobId: d.jobId,
        googleEventId: current.googleEventId,
        calendarId: current.calendarId,
      });
      ops.push({ type: "create", event: d });
    } else if (force || current.payloadHash !== d.hash)
      ops.push({ type: "update", event: d, googleEventId: current.googleEventId });
  }
  return ops;
}

/**
 * Which users' calendars a job change touches: whoever is assigned now plus whoever still
 * has an event for it (e.g. the technician it was just taken off).
 */
export function affectedUsers(assigneeIds: string[], usersWithEvent: string[]): string[] {
  return [...new Set([...assigneeIds, ...usersWithEvent])];
}
