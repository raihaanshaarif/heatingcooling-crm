import { describe, expect, it, vi } from "vitest";
import { estimateMatrix } from "./geo";
import {
  GoogleMapsApi,
  GoogleMapsError,
  buildGeocodeUrl,
  buildRouteMatrixBody,
  expandMatrix,
  parseDurationSeconds,
  parseGeocodeResponse,
  parseRouteMatrixResponse,
  uniquePoints,
} from "./google";
import { getMapsConfig } from "./config";

const A = { lat: -37.99, lng: 145.117 };
const B = { lat: -37.7667, lng: 144.9603 };
const C = { lat: -37.8182, lng: 145.0018 };

function mockFetch(responses: Response[]) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  });
}

describe("config", () => {
  it("is configured only with an API key", () => {
    expect(getMapsConfig({}).configured).toBe(false);
    expect(getMapsConfig({ GOOGLE_MAPS_API_KEY: "  " }).configured).toBe(false);
    const c = getMapsConfig({ GOOGLE_MAPS_API_KEY: "k", GOOGLE_ROUTES_URL: "http://mock" });
    expect(c).toMatchObject({ configured: true, apiKey: "k", routeMatrixUrl: "http://mock" });
  });
});

describe("geocoding", () => {
  it("asks for Australian results", () => {
    const url = new URL(buildGeocodeUrl("14 Albert St, Brunswick VIC 3056", "KEY"));
    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/geocode/json");
    expect(url.searchParams.get("address")).toBe("14 Albert St, Brunswick VIC 3056");
    expect(url.searchParams.get("region")).toBe("au");
    expect(url.searchParams.get("components")).toBe("country:AU");
    expect(url.searchParams.get("key")).toBe("KEY");
  });

  it("parses results, not-found and errors", () => {
    expect(
      parseGeocodeResponse({
        status: "OK",
        results: [
          {
            formatted_address: "14 Albert St, Brunswick VIC 3056, Australia",
            geometry: { location: { lat: -37.7671, lng: 144.9617 } },
          },
        ],
      }),
    ).toEqual({
      ok: true,
      lat: -37.7671,
      lng: 144.9617,
      formattedAddress: "14 Albert St, Brunswick VIC 3056, Australia",
      partial: false,
    });
    expect(parseGeocodeResponse({ status: "ZERO_RESULTS", results: [] })).toMatchObject({
      ok: false,
      notFound: true,
    });
    expect(() => parseGeocodeResponse({ status: "OVER_QUERY_LIMIT" })).toThrow(GoogleMapsError);
    try {
      parseGeocodeResponse({ status: "REQUEST_DENIED", error_message: "API key invalid" });
    } catch (e) {
      expect((e as GoogleMapsError).retryable).toBe(false);
      expect((e as GoogleMapsError).message).toContain("API key invalid");
    }
  });

  it("calls the Geocoding API with fetch", async () => {
    const fetchImpl = mockFetch([
      Response.json({
        status: "OK",
        results: [{ formatted_address: "x", partial_match: true, geometry: { location: B } }],
      }),
      new Response("{}", { status: 503 }),
    ]);
    const api = new GoogleMapsApi({
      apiKey: "KEY",
      geocodeUrl: "http://mock/geocode",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(api.geocode("14 Albert St")).resolves.toMatchObject({ ok: true, partial: true });
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(/^http:\/\/mock\/geocode\?address=14/);
    await expect(api.geocode("x")).rejects.toMatchObject({ retryable: true });
  });
});

describe("route matrix", () => {
  it("builds a traffic-aware request for a future departure", () => {
    const now = new Date("2026-10-15T09:00:00Z");
    const body = buildRouteMatrixBody([A, B], new Date("2026-10-15T20:00:00Z"), now);
    expect(body).toMatchObject({
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      departureTime: "2026-10-15T20:00:00.000Z",
      regionCode: "AU",
    });
    expect(body.origins[1]).toEqual({
      waypoint: { location: { latLng: { latitude: B.lat, longitude: B.lng } } },
    });
    expect(body.destinations).toEqual(body.origins);
    // Google rejects departure times in the past.
    const past = buildRouteMatrixBody([A, B], new Date("2026-10-14T20:00:00Z"), now);
    expect(past.routingPreference).toBe("TRAFFIC_UNAWARE");
    expect("departureTime" in past).toBe(false);
  });

  it("parses durations and elements (omitted zero indexes, missing routes)", () => {
    expect(parseDurationSeconds("754s")).toBe(754);
    expect(parseDurationSeconds("12.5s")).toBe(12.5);
    expect(parseDurationSeconds(42)).toBeNull();
    const parsed = parseRouteMatrixResponse(
      [
        {
          destinationIndex: 1,
          duration: "1501s",
          distanceMeters: 26_340,
          condition: "ROUTE_EXISTS",
        },
        { originIndex: 1, duration: "1620s", distanceMeters: 27_010, condition: "ROUTE_EXISTS" },
        { originIndex: 1, destinationIndex: 2, status: { code: 5, message: "not found" } },
        { originIndex: 2, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" },
        { originIndex: 0, destinationIndex: 0, duration: "0s", condition: "ROUTE_EXISTS" },
      ],
      3,
    );
    expect(parsed.minutes[0]![1]).toBe(26); // 1501 s rounds up
    expect(parsed.km[0]![1]).toBe(26.3);
    expect(parsed.minutes[1]![0]).toBe(27);
    expect(parsed.minutes[1]![2]).toBeNull();
    expect(parsed.minutes[2]![0]).toBeNull();
    expect(parsed.minutes[2]![2]).toBe(0);
    expect(() => parseRouteMatrixResponse({ error: {} }, 2)).toThrow(GoogleMapsError);
  });

  it("posts to computeRouteMatrix with the key and field mask", async () => {
    const fetchImpl = mockFetch([
      Response.json([
        { originIndex: 0, destinationIndex: 1, duration: "600s", distanceMeters: 8000 },
        { originIndex: 1, destinationIndex: 0, duration: "660s", distanceMeters: 8100 },
      ]),
      Response.json(
        {
          error: {
            code: 403,
            message: "Routes API has not been used",
            status: "PERMISSION_DENIED",
          },
        },
        { status: 403 },
      ),
    ]);
    const api = new GoogleMapsApi({
      apiKey: "KEY",
      routeMatrixUrl: "http://mock/matrix",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date("2026-10-15T00:00:00Z"),
    });
    const m = await api.routeMatrix([A, B], new Date("2026-10-15T20:00:00Z"));
    expect(m.minutes).toEqual([
      [0, 10],
      [11, 0],
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://mock/matrix");
    expect(init!.method).toBe("POST");
    expect(init!.headers).toMatchObject({
      "X-Goog-Api-Key": "KEY",
      "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status,condition",
    });
    expect(JSON.parse(init!.body as string).routingPreference).toBe("TRAFFIC_AWARE");
    await expect(api.routeMatrix([A, B], null)).rejects.toMatchObject({
      retryable: false,
      message: "Google Routes: Routes API has not been used",
    });
  });

  it("refuses more than 25 places and skips the call for one", async () => {
    const fetchImpl = mockFetch([]);
    const api = new GoogleMapsApi({ apiKey: "K", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(api.routeMatrix(new Array(26).fill(A), null)).rejects.toThrow(/25 places/);
    await expect(api.routeMatrix([A], null)).resolves.toEqual({ minutes: [[0]], km: [[0]] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("expands unique points back to the route's matrix, estimating gaps", () => {
    const points = [A, B, C, A, null];
    const unique = uniquePoints(points);
    expect(unique).toEqual([A, B, C]);
    const google = {
      minutes: [
        [0, 30, 20],
        [31, 0, null],
        [21, 12, 0],
      ],
      km: [
        [0, 30, 20],
        [31, 0, null],
        [21, 12, 0],
      ],
    };
    const fallback = estimateMatrix(points);
    const { matrix, estimatedPairs } = expandMatrix(points, unique, google, fallback);
    expect(matrix.minutes[0]![1]).toBe(30);
    expect(matrix.minutes[3]![2]).toBe(20); // the end (= depot) uses the depot's row
    expect(matrix.minutes[1]![2]).toBe(fallback.minutes[1]![2]);
    expect(matrix.minutes[4]![1]).toBe(0); // unknown point
    expect(estimatedPairs).toBe(1);
  });
});
