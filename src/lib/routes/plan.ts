/**
 * Turn a technician's scheduled jobs for one day into a route problem, and the solved
 * route back into proposed start / end times. Pure and unit-tested.
 */
import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE, fromMelbourneInput } from "@/lib/dates";
import type { LatLng, TravelMatrix } from "./geo";
import { buildSchedule, scheduleCost, solveRoute, type RouteStop, type Schedule } from "./solver";

export type FixedReason = "DONE" | "STARTED" | "ON_HOLD" | "TIME_FIXED" | "EMERGENCY" | "SHARED";

export const FIXED_REASON_LABELS: Record<FixedReason, string> = {
  DONE: "Completed",
  STARTED: "Under way",
  ON_HOLD: "On hold",
  TIME_FIXED: "Time fixed",
  EMERGENCY: "Emergency",
  SHARED: "Shared job",
};

export interface PlanJob {
  id: string;
  number: string;
  title: string;
  clientName: string;
  address: string;
  status: string;
  priority: string;
  timeFixed: boolean;
  start: Date;
  end: Date | null;
  estimatedMinutes: number | null;
  location: LatLng | null;
  /** Only placed at the suburb centre (no street-level location). */
  approximate?: boolean;
  /** Other technicians on the job: moving it would move them too. */
  otherTechnicians: string[];
}

/** Why a job keeps its time, or null when route planning may move it. */
export function fixedReason(
  job: Pick<PlanJob, "status" | "priority" | "timeFixed" | "otherTechnicians">,
): FixedReason | null {
  if (job.status === "COMPLETED" || job.status === "INVOICED") return "DONE";
  if (job.status === "EN_ROUTE" || job.status === "IN_PROGRESS") return "STARTED";
  if (job.status === "ON_HOLD") return "ON_HOLD";
  if (job.timeFixed) return "TIME_FIXED";
  if (job.priority === "EMERGENCY") return "EMERGENCY";
  if (job.otherTechnicians.length) return "SHARED";
  return null;
}

/** Minutes the job takes: its booked length, else the estimate, else 2 hours. */
export function jobDurationMinutes(
  job: Pick<PlanJob, "start" | "end" | "estimatedMinutes">,
): number {
  if (job.end && job.end > job.start)
    return Math.round((job.end.getTime() - job.start.getTime()) / 60_000);
  return job.estimatedMinutes && job.estimatedMinutes > 0 ? job.estimatedMinutes : 120;
}

/** Melbourne wall-clock minutes after midnight. */
export function minutesOfDay(date: Date): number {
  const [h, m] = formatInTimeZone(date, TIMEZONE, "HH:mm").split(":").map(Number);
  return h! * 60 + m!;
}

/** The instant at `minutes` after midnight (Melbourne wall clock) on day yyyy-MM-dd. */
export function atMinutes(day: string, minutes: number): Date {
  if (minutes < 0 || minutes >= 24 * 60) {
    return new Date(fromMelbourneInput(day).getTime() + minutes * 60_000);
  }
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return fromMelbourneInput(`${day}T${hh}:${mm}`);
}

/** "07:00" → 420. Invalid → 420. */
export function parseTimeOfDay(value: string | null | undefined, fallback = 7 * 60): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : fallback;
}

export function formatTimeOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Jobs on the map (in their current order) and jobs without a location. */
export function splitJobs(jobs: PlanJob[]) {
  const sorted = [...jobs].sort((a, b) => a.start.getTime() - b.start.getTime());
  return {
    routable: sorted.filter((j) => j.location),
    unlocated: sorted.filter((j) => !j.location),
  };
}

export interface PlanRow {
  job: PlanJob;
  fixedReason: FixedReason | null;
  currentPosition: number;
  proposedPosition: number;
  currentStart: Date;
  currentEnd: Date;
  proposedStart: Date;
  proposedEnd: Date;
  changed: boolean;
  currentTravel: { minutes: number; km: number };
  proposedTravel: { minutes: number; km: number };
  waitMinutes: number;
  lateMinutes: number;
}

export interface DayPlan {
  day: string;
  rows: PlanRow[];
  method: "exact" | "heuristic";
  before: { km: number; minutes: number; finish: Date };
  after: { km: number; minutes: number; finish: Date };
  saving: { km: number; minutes: number };
  /** Jobs whose times would change. */
  changes: number;
  /** Fixed-time stops the technician can't reach in time. */
  lateStops: number;
  returnTravel: { minutes: number; km: number };
  finish: Date;
  /** True when the current order is already the best one. */
  alreadyBest: boolean;
}

/**
 * Plan the day. `routable` must be in current order and match the matrix:
 * index 0 = start point, 1..n = routable jobs, n + 1 = end point.
 */
export function planDay(input: {
  day: string;
  routable: PlanJob[];
  matrix: TravelMatrix;
  dayStart: number;
  roundTo?: number;
}): DayPlan {
  const { day, routable, matrix, dayStart } = input;
  const reasons = routable.map(fixedReason);
  const stops: RouteStop[] = routable.map((job, i) => {
    const fixedAt = reasons[i] ? minutesOfDay(job.start) : null;
    return {
      id: job.id,
      durationMin: jobDurationMinutes(job),
      earliest: fixedAt,
      latest: fixedAt,
    };
  });
  const problem = { stops, matrix, dayStart, roundTo: input.roundTo ?? 5 };
  const currentOrder = routable.map((_, i) => i);
  const current = buildSchedule(problem, currentOrder);
  const solved = solveRoute(problem, currentOrder);
  // Never suggest something worse than what's booked.
  const alreadyBest =
    scheduleCost(current) <= scheduleCost(solved.schedule) + 1e-9 ||
    solved.schedule.order.every((s, i) => s === i);
  const proposed: Schedule = alreadyBest ? current : solved.schedule;

  const currentVisit = new Map(current.visits.map((v, i) => [v.stop, { v, position: i + 1 }]));
  const rows: PlanRow[] = proposed.visits.map((v, i) => {
    const job = routable[v.stop]!;
    const reason = reasons[v.stop]!;
    const duration = stops[v.stop]!.durationMin;
    const proposedStart = reason ? job.start : atMinutes(day, v.start);
    const proposedEnd = new Date(proposedStart.getTime() + duration * 60_000);
    const currentEnd = job.end ?? new Date(job.start.getTime() + duration * 60_000);
    const cv = currentVisit.get(v.stop)!;
    return {
      job,
      fixedReason: reason,
      currentPosition: cv.position,
      proposedPosition: i + 1,
      currentStart: job.start,
      currentEnd,
      proposedStart,
      proposedEnd,
      changed:
        !reason &&
        (Math.abs(proposedStart.getTime() - job.start.getTime()) >= 60_000 ||
          Math.abs(proposedEnd.getTime() - currentEnd.getTime()) >= 60_000),
      currentTravel: { minutes: cv.v.travelMinutes, km: cv.v.travelKm },
      proposedTravel: { minutes: v.travelMinutes, km: v.travelKm },
      waitMinutes: v.waitMinutes,
      lateMinutes: v.lateMinutes,
    };
  });
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    day,
    rows,
    method: solved.method,
    before: {
      km: current.driveKm,
      minutes: current.driveMinutes,
      finish: atMinutes(day, current.finish),
    },
    after: {
      km: proposed.driveKm,
      minutes: proposed.driveMinutes,
      finish: atMinutes(day, proposed.finish),
    },
    saving: {
      km: round1(current.driveKm - proposed.driveKm),
      minutes: current.driveMinutes - proposed.driveMinutes,
    },
    changes: rows.filter((r) => r.changed).length,
    lateStops: rows.filter((r) => r.lateMinutes > 0).length,
    returnTravel: { minutes: proposed.returnMinutes, km: proposed.returnKm },
    finish: atMinutes(day, proposed.finish),
    alreadyBest,
  };
}
