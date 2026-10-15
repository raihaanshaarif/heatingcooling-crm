import { describe, expect, it } from "vitest";
import { estimateMatrix, type LatLng, type TravelMatrix } from "./geo";
import {
  buildSchedule,
  improve,
  nearestNeighbour,
  scheduleCost,
  solveExact,
  solveHeuristic,
  solveRoute,
  type RouteProblem,
  type RouteStop,
} from "./solver";

/** Points on a line: 0 = depot at x=0, stops at the given x (1 minute and 1 km per unit). */
function lineMatrix(xs: number[]): TravelMatrix {
  const all = [0, ...xs, 0];
  return {
    minutes: all.map((a) => all.map((b) => Math.abs(a - b))),
    km: all.map((a) => all.map((b) => Math.abs(a - b))),
  };
}

const stop = (id: string, durationMin = 60, fixed?: number): RouteStop => ({
  id,
  durationMin,
  earliest: fixed ?? null,
  latest: fixed ?? null,
});

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  return permutations(n - 1).flatMap((p) =>
    Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]),
  );
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomProblem(n: number, seed: number, fixedCount = 0): RouteProblem {
  const r = rng(seed);
  const depot: LatLng = { lat: -37.99, lng: 145.117 };
  const pts: LatLng[] = Array.from({ length: n }, () => ({
    lat: -37.7 - r() * 0.35,
    lng: 144.75 + r() * 0.55,
  }));
  const stops = pts.map((_, i) => stop(`s${i}`, 30 + Math.floor(r() * 4) * 15));
  for (let k = 0; k < fixedCount; k++) {
    const s = stops[k]!;
    s.earliest = s.latest = 600 + k * 180; // 10:00, 13:00, …
  }
  return { stops, matrix: estimateMatrix([depot, ...pts, depot]), dayStart: 420 };
}

describe("buildSchedule", () => {
  it("leaves at day start, adds travel and durations, and drives home", () => {
    const p: RouteProblem = {
      stops: [stop("a", 60), stop("b", 90)],
      matrix: lineMatrix([10, 25]),
      dayStart: 420,
    };
    const s = buildSchedule(p, [0, 1]);
    expect(s.visits.map((v) => [v.arrival, v.start, v.end])).toEqual([
      [430, 430, 490],
      [505, 505, 595],
    ]);
    expect(s.driveMinutes).toBe(10 + 15 + 25);
    expect(s.driveKm).toBe(50);
    expect(s.returnMinutes).toBe(25);
    expect(s.finish).toBe(620);
    expect(s.lateMinutes).toBe(0);
  });

  it("rounds flexible starts up to 5 minutes", () => {
    const p: RouteProblem = { stops: [stop("a", 60)], matrix: lineMatrix([7]), dayStart: 420 };
    expect(buildSchedule(p, [0]).visits[0]!.start).toBe(430);
    expect(buildSchedule({ ...p, roundTo: 1 }, [0]).visits[0]!.start).toBe(427);
  });

  it("waits for a fixed-time stop and flags lateness when it can't be reached", () => {
    const p: RouteProblem = {
      stops: [stop("a", 60, 600), stop("b", 240)],
      matrix: lineMatrix([10, 20]),
      dayStart: 420,
    };
    const early = buildSchedule(p, [0, 1]);
    expect(early.visits[0]).toMatchObject({ arrival: 430, start: 600, waitMinutes: 170 });
    expect(early.lateMinutes).toBe(0);
    const late = buildSchedule(p, [1, 0]); // 4-hour job first: arrives at 10:00 + 4h…
    expect(late.visits[1]!.lateMinutes).toBeGreaterThan(0);
    expect(scheduleCost(late)).toBeGreaterThan(scheduleCost(early));
  });
});

describe("solver", () => {
  it("visits stops on a line in order (exact)", () => {
    const p: RouteProblem = {
      stops: [stop("c", 30), stop("a", 30), stop("d", 30), stop("b", 30)],
      matrix: lineMatrix([30, 10, 40, 20]),
      dayStart: 420,
    };
    const res = solveRoute(p);
    expect(res.method).toBe("exact");
    // Out to the far end and back once (any order that never doubles back is optimal).
    expect(res.schedule.driveMinutes).toBe(80);
    const current = buildSchedule(p, [0, 1, 2, 3]);
    expect(current.driveMinutes).toBe(30 + 20 + 30 + 20 + 20);
  });

  it("exact search matches brute force", () => {
    for (const seed of [1, 2, 3]) {
      const p = randomProblem(6, seed, seed === 3 ? 1 : 0);
      const best = Math.min(...permutations(6).map((o) => scheduleCost(buildSchedule(p, o))));
      expect(scheduleCost(solveExact(p))).toBeCloseTo(best, 6);
    }
  });

  it("uses exact search up to 8 stops and the heuristic above", () => {
    expect(solveRoute(randomProblem(8, 4)).method).toBe("exact");
    const big = solveRoute(randomProblem(12, 5));
    expect(big.method).toBe("heuristic");
    expect([...big.schedule.order].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i),
    );
  });

  it("heuristic beats plain nearest neighbour and stays close to exact", () => {
    for (const seed of [7, 8, 9, 10]) {
      const p = randomProblem(8, seed);
      const exact = scheduleCost(solveExact(p));
      const nn = scheduleCost(buildSchedule(p, nearestNeighbour(p)));
      const heur = scheduleCost(solveHeuristic(p));
      expect(heur).toBeLessThanOrEqual(nn + 1e-9);
      expect(heur).toBeGreaterThanOrEqual(exact - 1e-9);
      expect(heur).toBeLessThanOrEqual(exact * 1.1);
    }
  });

  it("2-opt untangles a crossed route", () => {
    const p: RouteProblem = {
      stops: [stop("a", 0), stop("b", 0), stop("c", 0), stop("d", 0)],
      matrix: lineMatrix([10, 20, 30, 40]),
      dayStart: 420,
      roundTo: 1,
    };
    expect(improve(p, [0, 2, 1, 3]).driveMinutes).toBe(80);
  });

  it("keeps fixed-time stops at their time (exact and heuristic)", () => {
    for (const n of [6, 11]) {
      const p = randomProblem(n, 20 + n, 2);
      const s = solveRoute(p).schedule;
      const fixed = s.visits.filter((v) => p.stops[v.stop]!.earliest != null);
      expect(fixed.map((v) => v.start).sort()).toEqual([600, 780]);
      expect(s.lateMinutes).toBe(0);
    }
  });

  it("puts a far stop before a fixed afternoon job when that's the only way to be on time", () => {
    // a: fixed 9:00 at x=10, b: 2h job at x=100, c: fixed 12:00 at x=12.
    const p: RouteProblem = {
      stops: [stop("a", 60, 540), stop("b", 120), stop("c", 60, 720)],
      matrix: lineMatrix([10, 100, 12]),
      dayStart: 420,
    };
    const s = solveRoute(p).schedule;
    expect(s.lateMinutes).toBe(0);
    expect(s.order.map((i) => p.stops[i]!.id).join("")).toBe("acb");
  });

  it("handles an empty day", () => {
    const s = solveRoute({ stops: [], matrix: lineMatrix([]), dayStart: 420 }).schedule;
    expect(s.visits).toEqual([]);
    expect(s.driveMinutes).toBe(0);
  });
});
