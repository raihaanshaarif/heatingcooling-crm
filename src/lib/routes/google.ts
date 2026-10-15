/**
 * Google Maps Platform calls for route planning, over plain fetch:
 * - Geocoding API (address → lat/lng), restricted to Australia.
 * - Routes API computeRouteMatrix (drive time and distance between every pair of stops,
 *   traffic-aware at the planned departure time).
 * Request building and response parsing are pure and unit-tested with a mocked fetch.
 */
import type { LatLng, TravelMatrix } from "./geo";

export const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
export const ROUTE_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
/** Routes API limit for TRAFFIC_AWARE: origins × destinations ≤ 625 (25 × 25). */
export const MAX_MATRIX_POINTS = 25;

export class GoogleMapsError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GoogleMapsError";
  }
}

// ─── Geocoding ───────────────────────────────────────────────────────────────

export function buildGeocodeUrl(address: string, apiKey: string, base = GEOCODE_URL): string {
  const params = new URLSearchParams({
    address,
    region: "au",
    components: "country:AU",
    key: apiKey,
  });
  return `${base}?${params.toString()}`;
}

export type GeocodeResult =
  | { ok: true; lat: number; lng: number; formattedAddress: string; partial: boolean }
  | { ok: false; notFound: true; message: string };

interface GeocodeResponse {
  status?: string;
  error_message?: string;
  results?: {
    formatted_address?: string;
    partial_match?: boolean;
    geometry?: { location?: { lat?: number; lng?: number } };
  }[];
}

/** Turn a Geocoding API response into a result; throws GoogleMapsError for API errors. */
export function parseGeocodeResponse(json: unknown): GeocodeResult {
  const body = (json ?? {}) as GeocodeResponse;
  switch (body.status) {
    case "OK": {
      const first = body.results?.[0];
      const loc = first?.geometry?.location;
      if (typeof loc?.lat !== "number" || typeof loc.lng !== "number")
        return { ok: false, notFound: true, message: "Google returned no location" };
      return {
        ok: true,
        lat: loc.lat,
        lng: loc.lng,
        formattedAddress: first?.formatted_address ?? "",
        partial: !!first?.partial_match,
      };
    }
    case "ZERO_RESULTS":
      return { ok: false, notFound: true, message: "Address not found by Google Maps" };
    case "OVER_QUERY_LIMIT":
    case "OVER_DAILY_LIMIT":
    case "UNKNOWN_ERROR":
      throw new GoogleMapsError(
        `Google Geocoding: ${body.status}${body.error_message ? ` – ${body.error_message}` : ""}`,
        true,
      );
    default:
      throw new GoogleMapsError(
        `Google Geocoding: ${body.status ?? "invalid response"}${body.error_message ? ` – ${body.error_message}` : ""}`,
        false,
      );
  }
}

// ─── Route matrix ────────────────────────────────────────────────────────────

const waypoint = (p: LatLng) => ({
  waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
});

/**
 * computeRouteMatrix body. Traffic-aware with the departure time when it is in the future
 * (Google rejects past departure times); otherwise traffic-unaware (typical conditions).
 */
export function buildRouteMatrixBody(points: LatLng[], departure: Date | null, now = new Date()) {
  const future = departure && departure.getTime() > now.getTime() + 60_000;
  return {
    origins: points.map(waypoint),
    destinations: points.map(waypoint),
    travelMode: "DRIVE",
    routingPreference: future ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE",
    ...(future ? { departureTime: departure.toISOString() } : {}),
    regionCode: "AU",
    units: "METRIC",
  };
}

export const ROUTE_MATRIX_FIELDS =
  "originIndex,destinationIndex,duration,distanceMeters,status,condition";

/** "1234s" → seconds. */
export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

interface MatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  distanceMeters?: number;
  status?: { code?: number; message?: string };
  condition?: string;
}

/**
 * Parse the computeRouteMatrix response (a JSON array of elements; Google omits zero fields,
 * so a missing originIndex means 0). Pairs without a route are null.
 */
export function parseRouteMatrixResponse(
  json: unknown,
  size: number,
): { minutes: (number | null)[][]; km: (number | null)[][] } {
  if (!Array.isArray(json)) throw new GoogleMapsError("Google Routes: unexpected response", false);
  const minutes: (number | null)[][] = Array.from({ length: size }, () =>
    new Array<number | null>(size).fill(null),
  );
  const km: (number | null)[][] = Array.from({ length: size }, () =>
    new Array<number | null>(size).fill(null),
  );
  for (const raw of json as MatrixElement[]) {
    const i = raw.originIndex ?? 0;
    const j = raw.destinationIndex ?? 0;
    if (i >= size || j >= size) continue;
    if (raw.status?.code) continue;
    if (raw.condition && raw.condition !== "ROUTE_EXISTS") continue;
    const seconds = parseDurationSeconds(raw.duration ?? "0s");
    if (seconds === null) continue;
    minutes[i]![j] = i === j ? 0 : Math.ceil(seconds / 60);
    km[i]![j] = i === j ? 0 : Math.round((raw.distanceMeters ?? 0) / 100) / 10;
  }
  for (let i = 0; i < size; i++) {
    minutes[i]![i] = 0;
    km[i]![i] = 0;
  }
  return { minutes, km };
}

/** Error message from a Google JSON error body ({ error: { message, status } }). */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } };
    return body.error?.message ?? body.error?.status ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export interface GoogleMapsApiOptions {
  apiKey: string;
  geocodeUrl?: string;
  routeMatrixUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class GoogleMapsApi {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: GoogleMapsApiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async geocode(address: string): Promise<GeocodeResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(
        buildGeocodeUrl(address, this.options.apiKey, this.options.geocodeUrl),
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (error) {
      throw new GoogleMapsError(
        `Couldn't reach Google Maps: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
    if (!res.ok)
      throw new GoogleMapsError(
        `Google Geocoding: ${await errorMessage(res)}`,
        res.status === 429 || res.status >= 500,
      );
    return parseGeocodeResponse(await res.json());
  }

  /** Drive minutes and km between every pair of points (null where Google found no route). */
  async routeMatrix(points: LatLng[], departure: Date | null) {
    if (points.length > MAX_MATRIX_POINTS)
      throw new GoogleMapsError(
        `Google Routes allows ${MAX_MATRIX_POINTS} places per request (this day has ${points.length})`,
        false,
      );
    if (points.length < 2) return parseRouteMatrixResponse([], points.length);
    let res: Response;
    try {
      res = await this.fetchImpl(this.options.routeMatrixUrl ?? ROUTE_MATRIX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.options.apiKey,
          "X-Goog-FieldMask": ROUTE_MATRIX_FIELDS,
        },
        body: JSON.stringify(
          buildRouteMatrixBody(points, departure, this.options.now?.() ?? new Date()),
        ),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new GoogleMapsError(
        `Couldn't reach Google Maps: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
    if (!res.ok)
      throw new GoogleMapsError(
        `Google Routes: ${await errorMessage(res)}`,
        res.status === 429 || res.status >= 500,
      );
    return parseRouteMatrixResponse(await res.json(), points.length);
  }
}

/**
 * Fill a matrix for possibly repeated / unknown points from Google results for the unique
 * known points. Unknown (null) points are 0 from everywhere; pairs Google couldn't route use
 * the fallback estimate.
 */
export function expandMatrix(
  points: (LatLng | null)[],
  unique: LatLng[],
  google: { minutes: (number | null)[][]; km: (number | null)[][] },
  fallback: TravelMatrix,
): { matrix: TravelMatrix; estimatedPairs: number } {
  const key = (p: LatLng) => `${p.lat},${p.lng}`;
  const index = new Map(unique.map((p, i) => [key(p), i]));
  let estimatedPairs = 0;
  const minutes: number[][] = [];
  const km: number[][] = [];
  points.forEach((a, i) => {
    minutes[i] = [];
    km[i] = [];
    points.forEach((b, j) => {
      if (!a || !b || i === j) {
        minutes[i]![j] = 0;
        km[i]![j] = 0;
        return;
      }
      const gi = index.get(key(a));
      const gj = index.get(key(b));
      const m = gi !== undefined && gj !== undefined ? google.minutes[gi]![gj] : null;
      const d = gi !== undefined && gj !== undefined ? google.km[gi]![gj] : null;
      if (m == null || d == null) {
        estimatedPairs += 1;
        minutes[i]![j] = fallback.minutes[i]![j]!;
        km[i]![j] = fallback.km[i]![j]!;
      } else {
        minutes[i]![j] = m;
        km[i]![j] = d;
      }
    });
  });
  return { matrix: { minutes, km }, estimatedPairs };
}

/** Unique known points (by exact coordinates), in first-seen order. */
export function uniquePoints(points: (LatLng | null)[]): LatLng[] {
  const seen = new Map<string, LatLng>();
  for (const p of points) if (p && !seen.has(`${p.lat},${p.lng}`)) seen.set(`${p.lat},${p.lng}`, p);
  return [...seen.values()];
}
