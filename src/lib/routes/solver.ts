/**
 * Route optimiser for one technician's day. Pure and unit-tested.
 *
 * Points are indexed like the travel matrix: 0 = start (depot or home), 1..n = the stops,
 * n + 1 = end (normally the start again). Times are minutes after midnight (Melbourne).
 *
 * - Every stop has a duration. A stop may have a time window (earliest / latest start);
 *   a job whose time is fixed (emergency, "time fixed", already started) has
 *   earliest = latest = its current start, so it keeps its time.
 * - The cost of an order is the total driving time plus idle time spent waiting for a
 *   fixed-time job (waiting is as wasted as driving: without it the cheapest plan could be
 *   "drive to the 1 pm job first and wait all morning"), plus a heavy penalty for every
 *   minute a stop starts after its latest start (so a feasible order always wins), plus a
 *   tiny tie-break on the finish time (prefer finishing earlier).
 * - Up to EXACT_LIMIT stops the best order is found by exhaustive search (branch and bound);
 *   above that nearest neighbour + 2-opt / relocate improvement.
 */
import type { TravelMatrix } from "./geo";

export interface RouteStop {
  id: string;
  durationMin: number;
  /** Earliest start (minutes after midnight): arriving earlier means waiting. */
  earliest?: number | null;
  /** Latest start: starting later is "late" and heavily penalised. */
  latest?: number | null;
}

export interface RouteProblem {
  stops: RouteStop[];
  /** (n + 2) × (n + 2): start, stops…, end. */
  matrix: TravelMatrix;
  /** When the technician leaves the start point. */
  dayStart: number;
  /** Round flexible start times up to this many minutes (default 5). */
  roundTo?: number;
}

export interface Visit {
  /** Index into problem.stops. */
  stop: number;
  arrival: number;
  start: number;
  end: number;
  /** Driving to this stop from the previous point. */
  travelMinutes: number;
  travelKm: number;
  waitMinutes: number;
  lateMinutes: number;
}

export interface Schedule {
  order: number[];
  visits: Visit[];
  /** Total driving including the drive back to the end point. */
  driveMinutes: number;
  driveKm: number;
  returnMinutes: number;
  returnKm: number;
  lateMinutes: number;
  /** Idle time waiting for fixed-time stops (and rounding). */
  waitMinutes: number;
  /** Back at the end point. */
  finish: number;
}

export const EXACT_LIMIT = 8;
const LATE_WEIGHT = 1000;
const FINISH_WEIGHT = 0.001;

export const isFixed = (s: RouteStop) =>
  s.earliest != null && s.latest != null && s.earliest === s.latest;

function startAt(stop: RouteStop, arrival: number, roundTo: number) {
  if (stop.earliest != null && arrival <= stop.earliest) return stop.earliest;
  if (isFixed(stop)) return arrival; // arriving late for a fixed job: start as soon as there
  return roundTo > 1 ? Math.ceil(arrival / roundTo) * roundTo : arrival;
}

/** Times for visiting the stops in `order`, leaving the start point at dayStart. */
export function buildSchedule(problem: RouteProblem, order: number[]): Schedule {
  const { stops, matrix } = problem;
  const roundTo = problem.roundTo ?? 5;
  const endIndex = stops.length + 1;
  let time = problem.dayStart;
  let prev = 0;
  let driveMinutes = 0;
  let driveKm = 0;
  let lateMinutes = 0;
  let waitMinutes = 0;
  const visits: Visit[] = [];
  for (const s of order) {
    const stop = stops[s]!;
    const idx = s + 1;
    const travelMinutes = matrix.minutes[prev]![idx]!;
    const travelKm = matrix.km[prev]![idx]!;
    const arrival = time + travelMinutes;
    const start = startAt(stop, arrival, roundTo);
    const late = stop.latest != null ? Math.max(0, start - stop.latest) : 0;
    const end = start + stop.durationMin;
    visits.push({
      stop: s,
      arrival,
      start,
      end,
      travelMinutes,
      travelKm,
      waitMinutes: Math.max(0, start - arrival),
      lateMinutes: late,
    });
    driveMinutes += travelMinutes;
    driveKm += travelKm;
    lateMinutes += late;
    waitMinutes += Math.max(0, start - arrival);
    time = end;
    prev = idx;
  }
  const returnMinutes = order.length ? matrix.minutes[prev]![endIndex]! : 0;
  const returnKm = order.length ? matrix.km[prev]![endIndex]! : 0;
  return {
    order: [...order],
    visits,
    driveMinutes: driveMinutes + returnMinutes,
    driveKm: Math.round((driveKm + returnKm) * 10) / 10,
    returnMinutes,
    returnKm,
    lateMinutes,
    waitMinutes,
    finish: time + returnMinutes,
  };
}

export function scheduleCost(s: Schedule): number {
  return s.driveMinutes + s.waitMinutes + LATE_WEIGHT * s.lateMinutes + FINISH_WEIGHT * s.finish;
}

export interface Solution {
  schedule: Schedule;
  method: "exact" | "heuristic";
}

/** Best order for the problem. `initial` (e.g. the current order) seeds the heuristic. */
export function solveRoute(problem: RouteProblem, initial?: number[]): Solution {
  const n = problem.stops.length;
  if (n <= EXACT_LIMIT) return { schedule: solveExact(problem), method: "exact" };
  return { schedule: solveHeuristic(problem, initial), method: "heuristic" };
}

/** Exhaustive search with branch and bound (n ≤ 8 → at most 40,320 orders). */
export function solveExact(problem: RouteProblem): Schedule {
  const { stops, matrix } = problem;
  const n = stops.length;
  const roundTo = problem.roundTo ?? 5;
  const endIndex = n + 1;
  let bestCost = Infinity;
  let bestOrder: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const order: number[] = [];

  const visit = (prev: number, time: number, drive: number, wait: number, late: number) => {
    if (drive + wait + LATE_WEIGHT * late >= bestCost) return;
    if (order.length === n) {
      const back = n ? matrix.minutes[prev]![endIndex]! : 0;
      const cost = drive + back + wait + LATE_WEIGHT * late + FINISH_WEIGHT * (time + back);
      if (cost < bestCost) {
        bestCost = cost;
        bestOrder = [...order];
      }
      return;
    }
    for (let s = 0; s < n; s++) {
      if (used[s]) continue;
      const stop = stops[s]!;
      const travel = matrix.minutes[prev]![s + 1]!;
      const arrival = time + travel;
      const start = startAt(stop, arrival, roundTo);
      const l = stop.latest != null ? Math.max(0, start - stop.latest) : 0;
      used[s] = true;
      order.push(s);
      visit(s + 1, start + stop.durationMin, drive + travel, wait + start - arrival, late + l);
      order.pop();
      used[s] = false;
    }
  };
  visit(0, problem.dayStart, 0, 0, 0);
  return buildSchedule(problem, bestOrder);
}

/** Nearest neighbour by drive time from the start point. */
export function nearestNeighbour(problem: RouteProblem): number[] {
  const n = problem.stops.length;
  const left = new Set(Array.from({ length: n }, (_, i) => i));
  const order: number[] = [];
  let prev = 0;
  while (left.size) {
    let best = -1;
    let bestMinutes = Infinity;
    for (const s of left) {
      const m = problem.matrix.minutes[prev]![s + 1]!;
      if (m < bestMinutes) {
        bestMinutes = m;
        best = s;
      }
    }
    order.push(best);
    left.delete(best);
    prev = best + 1;
  }
  return order;
}

/** Improve an order with 2-opt (reverse a section) and relocate (move one stop) until stuck. */
export function improve(problem: RouteProblem, start: number[]): Schedule {
  let order = [...start];
  let best = buildSchedule(problem, order);
  let bestCost = scheduleCost(best);
  const n = order.length;
  for (let round = 0; round < 200; round++) {
    let improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const reversed = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        const s = buildSchedule(problem, reversed);
        const c = scheduleCost(s);
        if (c < bestCost - 1e-9) {
          order = reversed;
          best = s;
          bestCost = c;
          improved = true;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const moved = [...order];
        const [item] = moved.splice(i, 1);
        moved.splice(j, 0, item!);
        const s = buildSchedule(problem, moved);
        const c = scheduleCost(s);
        if (c < bestCost - 1e-9) {
          order = moved;
          best = s;
          bestCost = c;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

/** Nearest neighbour + 2-opt, also starting from the given order (keeps a feasible start). */
export function solveHeuristic(problem: RouteProblem, initial?: number[]): Schedule {
  const n = problem.stops.length;
  const seeds = [nearestNeighbour(problem)];
  // Time-window order: fixed stops by time, flexible ones by nearest neighbour around them.
  seeds.push(
    Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => (problem.stops[a]!.earliest ?? -1) - (problem.stops[b]!.earliest ?? -1),
    ),
  );
  if (initial && initial.length === n) seeds.push(initial);
  let best: Schedule | null = null;
  for (const seed of seeds) {
    const s = improve(problem, seed);
    if (!best || scheduleCost(s) < scheduleCost(best)) best = s;
  }
  return best!;
}
