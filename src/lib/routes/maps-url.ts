/**
 * Links and image URLs for Google Maps. The directions links are plain Google Maps URLs
 * (no API key needed): they open the Google Maps app or website with the stops in order.
 */
import type { LatLng } from "./geo";

/**
 * Google Maps URLs accept up to 9 waypoints between origin and destination (3 in some
 * mobile browsers; the Google Maps app takes 9). Longer days are split into several links,
 * each starting where the previous one ended.
 */
export const MAX_WAYPOINTS = 9;

export type Place = string | LatLng;

const place = (p: Place) => (typeof p === "string" ? p : `${p.lat},${p.lng}`);

function directionsUrl(origin: Place | null, destination: Place, waypoints: Place[]): string {
  const params = new URLSearchParams({ api: "1" });
  if (origin) params.set("origin", place(origin));
  params.set("destination", place(destination));
  if (waypoints.length) params.set("waypoints", waypoints.map(place).join("|"));
  params.set("travelmode", "driving");
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Directions link(s) visiting `stops` in order. Without an origin Google starts from the
 * phone's current location. With a destination (the depot / home) the route ends there.
 */
export function googleMapsDirectionsUrls(input: {
  origin?: Place | null;
  destination?: Place | null;
  stops: Place[];
  maxWaypoints?: number;
}): string[] {
  const max = input.maxWaypoints ?? MAX_WAYPOINTS;
  const sequence = [...input.stops, ...(input.destination ? [input.destination] : [])];
  if (!sequence.length) return [];
  const urls: string[] = [];
  let from: Place | null = input.origin ?? null;
  let i = 0;
  while (i < sequence.length) {
    const chunk = sequence.slice(i, i + max + 1);
    const destination = chunk[chunk.length - 1]!;
    urls.push(directionsUrl(from, destination, chunk.slice(0, -1)));
    from = destination;
    i += chunk.length;
  }
  return urls;
}

/** Label for the nth stop on a static map: 1–9, then A–Z. */
export function markerLabel(n: number): string {
  if (n >= 1 && n <= 9) return String(n);
  const letter = n - 10;
  return letter >= 0 && letter < 26 ? String.fromCharCode(65 + letter) : "";
}

export const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";

export interface StaticMapInput {
  start?: LatLng | null;
  stops: { point: LatLng; label: string; fixed?: boolean }[];
  /** Route drawn as a line in this order (start, stops…, end). */
  path: LatLng[];
  width?: number;
  height?: number;
}

const coord = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Google Static Maps URL with numbered markers and the route line. */
export function buildStaticMapUrl(input: StaticMapInput, apiKey: string, base = STATIC_MAP_URL) {
  const params = new URLSearchParams();
  params.set("size", `${input.width ?? 640}x${input.height ?? 400}`);
  params.set("scale", "2");
  params.set("maptype", "roadmap");
  if (input.path.length > 1)
    params.append("path", `color:0x2563ebcc|weight:4|${input.path.map(coord).join("|")}`);
  if (input.start) params.append("markers", `color:0x111827|label:H|${coord(input.start)}`);
  for (const s of input.stops)
    params.append(
      "markers",
      `color:${s.fixed ? "0xdc2626" : "0x2563eb"}|label:${s.label}|${coord(s.point)}`,
    );
  params.set("key", apiKey);
  return `${base}?${params.toString()}`;
}
