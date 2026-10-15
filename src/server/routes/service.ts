import "server-only";
import type { RoutePlan } from "@prisma/client";
import { db } from "@/lib/db";
import { addMelbourneDays, fromMelbourneInput } from "@/lib/dates";
import { formatAddress } from "@/lib/utils";
import { getMapsConfig } from "@/lib/routes/config";
import {
  AVERAGE_SPEED_KMH,
  ROAD_FACTOR,
  estimateMatrix,
  toLatLng,
  type LatLng,
  type TravelMatrix,
} from "@/lib/routes/geo";
import { GoogleMapsApi, expandMatrix, uniquePoints } from "@/lib/routes/google";
import { googleMapsDirectionsUrls, markerLabel } from "@/lib/routes/maps-url";
import {
  atMinutes,
  fixedReason,
  parseTimeOfDay,
  planDay,
  splitJobs,
  type DayPlan,
  type PlanJob,
} from "@/lib/routes/plan";
import { getSettings } from "@/server/settings";

export const ESTIMATE_NOTE = `Estimated: straight-line distance × ${ROAD_FACTOR} at ${AVERAGE_SPEED_KMH} km/h. Add GOOGLE_MAPS_API_KEY for real drive times.`;

export interface RoutePoint {
  kind: "depot" | "home";
  label: string;
  address: string;
  location: LatLng | null;
}

/** Where the technician starts and ends the day: home if set and located, else the depot. */
export async function getStartPoint(technicianId: string): Promise<RoutePoint | null> {
  const [settings, tech] = await Promise.all([
    getSettings(),
    db.user.findUnique({
      where: { id: technicianId },
      select: { routeFromHome: true, homeAddress: true, homeLat: true, homeLng: true },
    }),
  ]);
  if (tech?.routeFromHome && tech.homeAddress) {
    const home = toLatLng({ lat: tech.homeLat, lng: tech.homeLng });
    if (home) return { kind: "home", label: "Home", address: tech.homeAddress, location: home };
  }
  if (!settings.addressLine1) return null;
  return {
    kind: "depot",
    label: "Depot",
    address: formatAddress({ ...settings, postcode: settings.postcode ?? undefined }),
    location: toLatLng({ lat: settings.depotLat, lng: settings.depotLng }),
  };
}

/** The technician's jobs on a Melbourne day (yyyy-MM-dd), cancelled ones left out. */
export async function loadDayJobs(technicianId: string, day: string): Promise<PlanJob[]> {
  const from = fromMelbourneInput(day);
  const to = addMelbourneDays(from, 1);
  const jobs = await db.job.findMany({
    where: {
      deletedAt: null,
      status: { not: "CANCELLED" },
      scheduledStart: { gte: from, lt: to },
      assignments: { some: { userId: technicianId } },
    },
    include: {
      client: { select: { name: true } },
      property: true,
      assignments: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { scheduledStart: "asc" },
  });
  return jobs.map((j) => ({
    id: j.id,
    number: j.number,
    title: j.title,
    clientName: j.client.name,
    address: j.property ? formatAddress(j.property) : "",
    status: j.status,
    priority: j.priority,
    timeFixed: j.timeFixed,
    start: j.scheduledStart!,
    end: j.scheduledEnd,
    estimatedMinutes: j.estimatedMinutes,
    location: toLatLng(j.property),
    approximate: j.property?.geocodeSource === "SUBURB",
    otherTechnicians: j.assignments
      .filter((a) => a.userId !== technicianId)
      .map((a) => a.user.name),
  }));
}

export type TravelProvider = "google" | "estimate";

/**
 * Travel times between the points. With GOOGLE_MAPS_API_KEY: Google Routes computeRouteMatrix
 * (traffic-aware at the departure time). Without it, or if Google fails, straight-line
 * estimates; Google is never called without a key.
 */
export async function getTravelMatrix(
  points: (LatLng | null)[],
  departure: Date,
): Promise<{ matrix: TravelMatrix; provider: TravelProvider; note: string | null }> {
  const estimate = estimateMatrix(points);
  const config = getMapsConfig();
  if (!config.apiKey) {
    console.info(
      `[maps:dev] GOOGLE_MAPS_API_KEY not set, not calling Google Routes: estimating ${points.length} places.`,
    );
    return { matrix: estimate, provider: "estimate", note: null };
  }
  const unique = uniquePoints(points);
  if (unique.length < 2) return { matrix: estimate, provider: "google", note: null };
  try {
    const api = new GoogleMapsApi({ apiKey: config.apiKey, routeMatrixUrl: config.routeMatrixUrl });
    const google = await api.routeMatrix(unique, departure);
    const { matrix, estimatedPairs } = expandMatrix(points, unique, google, estimate);
    return {
      matrix,
      provider: "google",
      note: estimatedPairs
        ? `Google Maps found no road route for ${estimatedPairs} leg${estimatedPairs === 1 ? "" : "s"}; those are estimated.`
        : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[maps] route matrix failed, using estimates", message);
    return {
      matrix: estimate,
      provider: "estimate",
      note: `Google Maps couldn't be used (${message}), so drive times are estimated.`,
    };
  }
}

/** Address used for a stop in Google Maps links. */
const linkPlace = (j: { address: string; location: LatLng | null }) => j.address || j.location;

export interface StopMarker {
  jobId: string;
  number: string;
  label: string;
  lat: number;
  lng: number;
  fixed: boolean;
  approximate: boolean;
}

export interface RoutePlanView {
  technician: { id: string; name: string; color: string };
  day: string;
  dayStart: number;
  /** Departure was moved to "now" because the day has started. */
  startsNow: boolean;
  start: RoutePoint | null;
  provider: TravelProvider;
  notes: string[];
  plan: DayPlan | null;
  unlocated: PlanJob[];
  markers: StopMarker[];
  /** Current order, for drawing the old route. */
  currentPath: LatLng[];
  proposedPath: LatLng[];
  mapsUrls: string[];
  staticMapSrc: string | null;
  lastApplied: (RoutePlan & { appliedBy: { name: string } | null }) | null;
}

/** Plan a technician's day: current vs proposed order and times. */
export async function planRoute(technicianId: string, day: string): Promise<RoutePlanView | null> {
  const technician = await db.user.findFirst({
    where: { id: technicianId, active: true },
    select: { id: true, name: true, color: true },
  });
  if (!technician) return null;
  const settings = await getSettings();
  const [jobs, start, lastApplied] = await Promise.all([
    loadDayJobs(technicianId, day),
    getStartPoint(technicianId),
    db.routePlan.findFirst({
      where: { technicianId, date: day },
      orderBy: { createdAt: "desc" },
      include: { appliedBy: { select: { name: true } } },
    }),
  ]);
  const notes: string[] = [];
  let dayStart = parseTimeOfDay(settings.routeDayStart);
  // Planning today after the start time: plan from now (rounded up to 15 minutes).
  const now = new Date();
  const startInstant = atMinutes(day, dayStart);
  let startsNow = false;
  if (now > startInstant && now < addMelbourneDays(fromMelbourneInput(day), 1)) {
    const elapsed =
      Math.ceil((now.getTime() - fromMelbourneInput(day).getTime()) / 60_000 / 15) * 15;
    if (elapsed > dayStart) {
      dayStart = elapsed;
      startsNow = true;
    }
  }
  if (!start)
    notes.push(
      "No business address yet (Settings → Business), so the route starts at the first job.",
    );
  else if (!start.location)
    notes.push(
      `The ${start.label.toLowerCase()} address isn't on the map yet, so the route starts at the first job. Use “Geocode missing addresses” on the Integrations page.`,
    );

  const { routable, unlocated } = splitJobs(jobs);
  if (unlocated.length)
    notes.push(
      `${unlocated.length} job${unlocated.length === 1 ? " has" : "s have"} no map location and ${unlocated.length === 1 ? "keeps its" : "keep their"} time (add the site address, or run “Geocode missing addresses”).`,
    );
  const approx = jobs.filter((j) => j.location && j.approximate);
  if (approx.length)
    notes.push(
      `${approx.length} address${approx.length === 1 ? " is" : "es are"} only placed at the suburb centre, so ${approx.length === 1 ? "its" : "their"} drive times are rough.`,
    );

  let plan: DayPlan | null = null;
  let provider: TravelProvider = getMapsConfig().configured ? "google" : "estimate";
  if (routable.length) {
    const startLoc = start?.location ?? null;
    const points = [startLoc, ...routable.map((j) => j.location), startLoc];
    const travel = await getTravelMatrix(points, atMinutes(day, dayStart));
    provider = travel.provider;
    if (travel.note) notes.push(travel.note);
    plan = planDay({ day, routable, matrix: travel.matrix, dayStart });
  }

  const markers: StopMarker[] = (plan?.rows ?? []).map((r, i) => ({
    jobId: r.job.id,
    number: r.job.number,
    label: markerLabel(i + 1) || String(i + 1),
    lat: r.job.location!.lat,
    lng: r.job.location!.lng,
    fixed: !!r.fixedReason,
    approximate: !!r.job.approximate,
  }));
  const ends = start?.location ? [start.location] : [];
  const proposedPath = [...ends, ...markers.map((m) => ({ lat: m.lat, lng: m.lng })), ...ends];
  const currentPath = [...ends, ...routable.map((j) => j.location!), ...ends];

  const mapsUrls = plan
    ? googleMapsDirectionsUrls({
        origin: start?.address ?? null,
        destination: start?.address ?? null,
        stops: plan.rows.map((r) => linkPlace(r.job)!),
      })
    : [];

  let staticMapSrc: string | null = null;
  if (getMapsConfig().configured && markers.length) {
    const params = new URLSearchParams();
    if (start?.location) params.set("s", `${start.location.lat},${start.location.lng}`);
    for (const m of markers) params.append("p", `${m.lat},${m.lng},${m.label},${m.fixed ? 1 : 0}`);
    staticMapSrc = `/api/routes/static-map?${params.toString()}`;
  }

  return {
    technician,
    day,
    dayStart,
    startsNow,
    start,
    provider,
    notes,
    plan,
    unlocated,
    markers,
    currentPath,
    proposedPath,
    mapsUrls,
    staticMapSrc,
    lastApplied,
  };
}

/**
 * The technician's own "Open in Google Maps" links for a day: the jobs still to do, in
 * booked order, ending at the depot / home. Starts from the depot / home before the first
 * job is under way, otherwise from wherever the phone is.
 */
export async function getDayRouteLinks(technicianId: string, day: string) {
  const [jobs, start] = await Promise.all([
    loadDayJobs(technicianId, day),
    getStartPoint(technicianId),
  ]);
  const todo = jobs.filter((j) => !["COMPLETED", "INVOICED"].includes(j.status));
  const stops = todo.map(linkPlace).filter((p): p is string | LatLng => !!p);
  const started = jobs.some((j) => fixedReason(j) === "DONE" || fixedReason(j) === "STARTED");
  return {
    stops: stops.length,
    urls: googleMapsDirectionsUrls({
      origin: started ? null : (start?.address ?? null),
      destination: start?.address ?? null,
      stops,
    }),
  };
}
