/**
 * Distances and drive-time estimates for route planning when Google Maps isn't set up:
 * straight-line (great-circle) distance × a road factor, at an assumed average speed.
 * Pure and unit-tested.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Roads are rarely straight: suburban drives are ~1.3× the straight-line distance. */
export const ROAD_FACTOR = 1.3;
/** Average suburban Melbourne speed including lights and traffic. */
export const AVERAGE_SPEED_KMH = 40;

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface TravelEstimate {
  km: number;
  minutes: number;
}

export interface EstimateOptions {
  roadFactor?: number;
  speedKmh?: number;
}

/** Estimated road distance and drive time between two points (whole minutes, rounded up). */
export function estimateTravel(
  a: LatLng,
  b: LatLng,
  options: EstimateOptions = {},
): TravelEstimate {
  const km = haversineKm(a, b) * (options.roadFactor ?? ROAD_FACTOR);
  const minutes = km === 0 ? 0 : Math.ceil((km / (options.speedKmh ?? AVERAGE_SPEED_KMH)) * 60);
  return { km: Math.round(km * 10) / 10, minutes };
}

/** Travel matrix: minutes[i][j] and km[i][j] from point i to point j. */
export interface TravelMatrix {
  minutes: number[][];
  km: number[][];
}

/**
 * Estimated matrix for a list of points. A null point (an unknown start / end) is 0 km and 0
 * minutes from everywhere, so the route simply starts (or ends) at the first (or last) job.
 */
export function estimateMatrix(
  points: (LatLng | null)[],
  options: EstimateOptions = {},
): TravelMatrix {
  const minutes: number[][] = [];
  const km: number[][] = [];
  points.forEach((a, i) => {
    minutes[i] = [];
    km[i] = [];
    points.forEach((b, j) => {
      const t = i === j || !a || !b ? { km: 0, minutes: 0 } : estimateTravel(a, b, options);
      minutes[i]![j] = t.minutes;
      km[i]![j] = t.km;
    });
  });
  return { minutes, km };
}

export function isValidLatLng(p: { lat?: number | null; lng?: number | null } | null | undefined) {
  return (
    !!p &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

export function toLatLng(
  p: { lat?: number | null; lng?: number | null } | null | undefined,
): LatLng | null {
  return isValidLatLng(p) ? { lat: p!.lat!, lng: p!.lng! } : null;
}
