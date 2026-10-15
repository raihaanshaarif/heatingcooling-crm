"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { addMelbourneDays, formatDate, formatTime, fromMelbourneInput } from "@/lib/dates";
import { fixedReason, FIXED_REASON_LABELS } from "@/lib/routes/plan";
import {
  applyRoutePlanSchema,
  routeStartSchema,
  type ApplyRoutePlanInput,
  type RouteStartInput,
} from "@/lib/validations/routes";
import { NotFoundError, UserError, idSchema, runAction } from "@/server/action";
import { audit, notifyUsers } from "@/server/audit";
import { kickCalendarSync } from "@/server/google-calendar/queue";
import { rescheduleJobInTx } from "@/server/jobs/service";
import { geocodeDepot, geocodeMissingProperties, geocodeUserHome, kickGeocode } from "./geocode";

interface PlanEntry {
  jobId: string;
  number: string;
  start: string;
  end: string;
}

function revalidateRoutes() {
  revalidatePath("/schedule");
  revalidatePath("/schedule/route");
  revalidatePath("/my-jobs");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
}

const sameMinute = (a: Date | null, b: Date) => !!a && Math.abs(a.getTime() - b.getTime()) < 60_000;

/**
 * Apply a route plan: move every changed job to its proposed time in one transaction,
 * through the same reschedule logic as the Schedule board (timeline, audit, Google
 * Calendar), and remember the old times so it can be undone.
 */
export async function applyRoutePlan(input: ApplyRoutePlanInput) {
  return runAction(
    { schema: applyRoutePlanSchema, permission: ["update", "routes"] },
    input,
    async (d, user) => {
      const dayFrom = fromMelbourneInput(d.day);
      const dayTo = addMelbourneDays(dayFrom, 1);
      const plan = await db.$transaction(async (tx) => {
        const previous: PlanEntry[] = [];
        const applied: PlanEntry[] = [];
        for (const item of d.jobs) {
          const job = await tx.job.findFirst({
            where: { id: item.id, deletedAt: null },
            include: { assignments: { include: { user: { select: { name: true } } } } },
          });
          if (!job) throw new NotFoundError("Job");
          if (!job.assignments.some((a) => a.userId === d.technicianId))
            throw new UserError(`${job.number} isn't assigned to this technician any more.`);
          if (!sameMinute(job.scheduledStart, item.from))
            throw new UserError(
              `${job.number} was moved since this plan was made. Reload the plan and try again.`,
            );
          const reason = fixedReason({
            status: job.status,
            priority: job.priority,
            timeFixed: job.timeFixed,
            otherTechnicians: job.assignments
              .filter((a) => a.userId !== d.technicianId)
              .map((a) => a.user.name),
          });
          if (reason)
            throw new UserError(
              `${job.number} keeps its time (${FIXED_REASON_LABELS[reason].toLowerCase()}).`,
            );
          if (item.start < dayFrom || item.start >= dayTo)
            throw new UserError(`${job.number}'s new time isn't on ${formatDate(dayFrom)}.`);
          previous.push({
            jobId: job.id,
            number: job.number,
            start: job.scheduledStart!.toISOString(),
            end: (job.scheduledEnd ?? item.end).toISOString(),
          });
          applied.push({
            jobId: job.id,
            number: job.number,
            start: item.start.toISOString(),
            end: item.end.toISOString(),
          });
          await rescheduleJobInTx(tx, user.id, {
            id: job.id,
            start: item.start,
            end: item.end,
            reason: "route plan",
          });
        }
        const created = await tx.routePlan.create({
          data: {
            technicianId: d.technicianId,
            date: d.day,
            appliedById: user.id,
            provider: d.provider,
            previous: previous as unknown as object,
            applied: applied as unknown as object,
            beforeKm: d.before.km,
            afterKm: d.after.km,
            beforeMinutes: d.before.minutes,
            afterMinutes: d.after.minutes,
          },
        });
        await audit(tx, {
          userId: user.id,
          action: "APPLY",
          entityType: "ROUTE_PLAN",
          entityId: created.id,
          changes: {
            technicianId: d.technicianId,
            day: d.day,
            jobs: applied.map((a, i) => ({
              number: a.number,
              from: previous[i]!.start,
              to: a.start,
            })),
            driveKm: { from: d.before.km, to: d.after.km },
            driveMinutes: { from: d.before.minutes, to: d.after.minutes },
          },
        });
        if (d.technicianId !== user.id)
          await notifyUsers(tx, [d.technicianId], {
            title: `Your route for ${formatDate(dayFrom, "EEE d MMM")} was updated`,
            body: `${applied.length} job${applied.length === 1 ? "" : "s"} have new times: ${applied
              .map((a) => `${a.number} ${formatTime(a.start)}`)
              .join(", ")}`,
            link: "/my-jobs",
          });
        return created;
      });
      kickCalendarSync();
      revalidateRoutes();
      return { id: plan.id, changed: d.jobs.length };
    },
  );
}

/** Put the jobs back to their times before the plan (skipping any that were moved again since). */
export async function undoRoutePlan(input: { id: string }) {
  return runAction(
    { schema: idSchema, permission: ["update", "routes"] },
    input,
    async ({ id }, user) => {
      const result = await db.$transaction(async (tx) => {
        const plan = await tx.routePlan.findUnique({ where: { id } });
        if (!plan) throw new NotFoundError("Route plan");
        if (plan.undoneAt) throw new UserError("This route plan was already undone.");
        const previous = plan.previous as unknown as PlanEntry[];
        const applied = new Map((plan.applied as unknown as PlanEntry[]).map((a) => [a.jobId, a]));
        const restored: string[] = [];
        const skipped: string[] = [];
        for (const p of previous) {
          const job = await tx.job.findFirst({ where: { id: p.jobId, deletedAt: null } });
          const a = applied.get(p.jobId);
          if (
            !job ||
            !a ||
            ["COMPLETED", "INVOICED", "CANCELLED"].includes(job.status) ||
            !sameMinute(job.scheduledStart, new Date(a.start))
          ) {
            skipped.push(p.number);
            continue;
          }
          await rescheduleJobInTx(tx, user.id, {
            id: p.jobId,
            start: new Date(p.start),
            end: new Date(p.end),
            reason: "route plan undone",
          });
          restored.push(p.number);
        }
        await tx.routePlan.update({
          where: { id },
          data: { undoneAt: new Date(), undoneById: user.id },
        });
        await audit(tx, {
          userId: user.id,
          action: "UNDO",
          entityType: "ROUTE_PLAN",
          entityId: id,
          changes: { restored, skipped },
        });
        return { restored, skipped };
      });
      kickCalendarSync();
      revalidateRoutes();
      return result;
    },
  );
}

/** Where a technician starts and ends the day: the depot (default) or their home. */
export async function saveRouteStart(input: RouteStartInput) {
  return runAction(
    { schema: routeStartSchema, permission: ["update", "routes"] },
    input,
    async (d, user) => {
      const before = await db.user.findUnique({ where: { id: d.userId } });
      if (!before) throw new NotFoundError("User");
      const moved = (before.homeAddress ?? null) !== d.homeAddress;
      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: d.userId },
          data: {
            routeFromHome: d.routeFromHome,
            homeAddress: d.homeAddress,
            ...(moved ? { homeLat: null, homeLng: null, homeGeocodeSource: null } : {}),
          },
        });
        await audit(tx, {
          userId: user.id,
          action: "UPDATE",
          entityType: "USER",
          entityId: d.userId,
          changes: {
            routeFromHome: { from: before.routeFromHome, to: d.routeFromHome },
            ...(moved ? { homeAddress: { from: before.homeAddress, to: d.homeAddress } } : {}),
          },
        });
      });
      if (moved && d.homeAddress) kickGeocode(() => geocodeUserHome(d.userId));
      revalidatePath(`/team/${d.userId}`);
      revalidatePath("/schedule/route");
      return { id: d.userId };
    },
  );
}

/** Admin: locate every address that isn't on the map yet (and the depot). */
export async function geocodeMissingAddresses() {
  return runAction(
    { schema: z.undefined().optional(), permission: ["update", "settings"] },
    undefined,
    async (_d, user) => {
      const settings = await db.businessSettings.findUnique({ where: { id: "singleton" } });
      let depot = false;
      if (
        settings?.addressLine1 &&
        (settings.depotLat === null || settings.depotGeocodeSource === "SUBURB")
      ) {
        const r = await geocodeDepot();
        depot = !!r?.ok;
      }
      const summary = await geocodeMissingProperties({ limit: 500, retryFailed: true });
      await audit(db, {
        userId: user.id,
        action: "GEOCODE",
        entityType: "SETTINGS",
        entityId: "routes",
        changes: { ...summary, depot },
      });
      revalidatePath("/integrations");
      revalidatePath("/settings");
      revalidatePath("/schedule/route");
      return { ...summary, depot };
    },
  );
}
