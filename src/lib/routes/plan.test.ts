import { describe, expect, it } from "vitest";
import { fromMelbourneInput } from "@/lib/dates";
import {
  atMinutes,
  fixedReason,
  formatTimeOfDay,
  jobDurationMinutes,
  minutesOfDay,
  parseTimeOfDay,
  planDay,
  splitJobs,
  type PlanJob,
} from "./plan";
import type { TravelMatrix } from "./geo";

const DAY = "2026-10-16";
const t = (hhmm: string) => fromMelbourneInput(`${DAY}T${hhmm}`);

function job(id: string, start: string, minutes: number, extra: Partial<PlanJob> = {}): PlanJob {
  const s = t(start);
  return {
    id,
    number: `J-${id}`,
    title: "Service",
    clientName: "Client",
    address: "1 Main St",
    status: "SCHEDULED",
    priority: "NORMAL",
    timeFixed: false,
    start: s,
    end: new Date(s.getTime() + minutes * 60_000),
    estimatedMinutes: minutes,
    location: { lat: -37.8, lng: 145 },
    otherTechnicians: [],
    ...extra,
  };
}

/** Depot at x=0, jobs at xs (1 minute / 1 km per unit). */
function lineMatrix(xs: number[]): TravelMatrix {
  const all = [0, ...xs, 0];
  const m = all.map((a) => all.map((b) => Math.abs(a - b)));
  return { minutes: m, km: m };
}

describe("day planning helpers", () => {
  it("converts Melbourne times of day, across daylight saving", () => {
    expect(minutesOfDay(t("09:30"))).toBe(570);
    expect(atMinutes(DAY, 570).toISOString()).toBe(t("09:30").toISOString());
    // 16 Oct 2026 is AEDT (UTC+11): 7:00 am is 20:00 UTC the day before.
    expect(atMinutes(DAY, 420).toISOString()).toBe("2026-10-15T20:00:00.000Z");
    // June is AEST (UTC+10).
    expect(atMinutes("2026-06-16", 420).toISOString()).toBe("2026-06-15T21:00:00.000Z");
    expect(parseTimeOfDay("07:30")).toBe(450);
    expect(parseTimeOfDay("bad")).toBe(420);
    expect(formatTimeOfDay(450)).toBe("7:30 am");
    expect(formatTimeOfDay(780)).toBe("1:00 pm");
  });

  it("knows which jobs keep their time", () => {
    const base = job("1", "08:00", 60);
    expect(fixedReason(base)).toBeNull();
    expect(fixedReason({ ...base, timeFixed: true })).toBe("TIME_FIXED");
    expect(fixedReason({ ...base, priority: "EMERGENCY" })).toBe("EMERGENCY");
    expect(fixedReason({ ...base, status: "IN_PROGRESS" })).toBe("STARTED");
    expect(fixedReason({ ...base, status: "COMPLETED" })).toBe("DONE");
    expect(fixedReason({ ...base, otherTechnicians: ["Liam"] })).toBe("SHARED");
  });

  it("uses the booked length, then the estimate, then 2 hours", () => {
    expect(jobDurationMinutes(job("1", "08:00", 90))).toBe(90);
    expect(jobDurationMinutes({ start: t("08:00"), end: null, estimatedMinutes: 45 })).toBe(45);
    expect(jobDurationMinutes({ start: t("08:00"), end: null, estimatedMinutes: null })).toBe(120);
  });

  it("splits out jobs without a location and sorts by current time", () => {
    const { routable, unlocated } = splitJobs([
      job("b", "11:00", 60),
      job("x", "09:00", 60, { location: null }),
      job("a", "08:00", 60),
    ]);
    expect(routable.map((j) => j.id)).toEqual(["a", "b"]);
    expect(unlocated.map((j) => j.id)).toEqual(["x"]);
  });
});

describe("planDay", () => {
  it("re-orders a zig-zag day, packs times from 7:00 and reports the saving", () => {
    // Current order: x=40, 10, 30, 20 → 40+30+20+10+20 = 120 min. Best: 10,20,30,40 → 80.
    const routable = [
      job("d", "07:30", 60),
      job("a", "09:00", 60),
      job("c", "11:00", 60),
      job("b", "13:00", 60),
    ];
    const plan = planDay({
      day: DAY,
      routable,
      matrix: lineMatrix([40, 10, 30, 20]),
      dayStart: 420,
    });
    expect(plan.method).toBe("exact");
    expect(plan.before).toMatchObject({ km: 120, minutes: 120 });
    expect(plan.after).toMatchObject({ km: 80, minutes: 80 });
    expect(plan.after.finish < plan.before.finish).toBe(true);
    expect(plan.saving).toEqual({ km: 40, minutes: 40 });
    const order = plan.rows.map((r) => r.job.id).join("");
    expect(["abcd", "dcba"]).toContain(order);
    const first = plan.rows[0]!;
    expect(first.proposedPosition).toBe(1);
    // Leaves at 7:00, drives 10 (or 40) minutes.
    expect(minutesOfDay(first.proposedStart)).toBe(order === "abcd" ? 430 : 460);
    // Each next job starts after the previous one ends plus the drive (rounded to 5 min).
    for (let i = 1; i < plan.rows.length; i++) {
      const prev = plan.rows[i - 1]!;
      const row = plan.rows[i]!;
      expect(row.proposedStart.getTime()).toBeGreaterThanOrEqual(
        prev.proposedEnd.getTime() + row.proposedTravel.minutes * 60_000,
      );
      expect(minutesOfDay(row.proposedStart) % 5).toBe(0);
    }
    expect(plan.changes).toBe(4);
    expect(plan.alreadyBest).toBe(false);
  });

  it("never moves fixed-time or emergency jobs", () => {
    const routable = [
      job("a", "08:00", 60),
      job("fixed", "10:00", 60, { timeFixed: true }),
      job("b", "12:00", 60),
      job("sos", "14:00", 60, { priority: "EMERGENCY" }),
    ];
    const plan = planDay({
      day: DAY,
      routable,
      matrix: lineMatrix([50, 5, 45, 10]),
      dayStart: 420,
    });
    const fixed = plan.rows.find((r) => r.job.id === "fixed")!;
    const sos = plan.rows.find((r) => r.job.id === "sos")!;
    expect(fixed.fixedReason).toBe("TIME_FIXED");
    expect(fixed.proposedStart).toEqual(t("10:00"));
    expect(fixed.changed).toBe(false);
    expect(sos.proposedStart).toEqual(t("14:00"));
    expect(plan.lateStops).toBe(0);
    // Flexible jobs don't overlap the fixed ones.
    for (const r of plan.rows.filter((x) => !x.fixedReason)) {
      for (const f of [fixed, sos]) {
        const overlap = r.proposedStart < f.proposedEnd && f.proposedStart < r.proposedEnd;
        expect(overlap).toBe(false);
      }
    }
  });

  it("fills the morning instead of waiting for a fixed afternoon job", () => {
    const routable = [
      job("a", "08:00", 60),
      job("fixed", "13:00", 60, { timeFixed: true }),
      job("b", "14:30", 60),
      job("c", "16:00", 60),
    ];
    // The fixed job is the nearest stop, but going there first would mean 5+ idle hours.
    const plan = planDay({
      day: DAY,
      routable,
      matrix: lineMatrix([20, 5, 25, 30]),
      dayStart: 420,
    });
    const order = plan.rows.map((r) => r.job.id);
    expect(order[0]).not.toBe("fixed");
    expect(plan.rows.find((r) => r.job.id === "fixed")!.proposedStart).toEqual(t("13:00"));
    expect(plan.lateStops).toBe(0);
    expect(minutesOfDay(plan.after.finish)).toBeLessThanOrEqual(16 * 60);
  });

  it("keeps the current order when it's already the best", () => {
    const routable = [job("a", "07:10", 60), job("b", "08:20", 60)];
    const plan = planDay({ day: DAY, routable, matrix: lineMatrix([10, 20]), dayStart: 420 });
    expect(plan.alreadyBest).toBe(true);
    expect(plan.saving).toEqual({ km: 0, minutes: 0 });
    expect(plan.rows.map((r) => r.job.id)).toEqual(["a", "b"]);
    expect(plan.changes).toBe(0);
  });

  it("flags a fixed job that can't be reached in time", () => {
    const routable = [job("far", "07:05", 60, { timeFixed: true })];
    const plan = planDay({ day: DAY, routable, matrix: lineMatrix([30]), dayStart: 420 });
    expect(plan.lateStops).toBe(1);
    expect(plan.rows[0]!.lateMinutes).toBe(25);
    expect(plan.rows[0]!.proposedStart).toEqual(t("07:05"));
  });
});
