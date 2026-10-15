import { describe, expect, it } from "vitest";
import { buildStaticMapUrl, googleMapsDirectionsUrls, markerLabel } from "./maps-url";

const q = (url: string) => new URL(url).searchParams;

describe("Google Maps directions links", () => {
  it("lists the stops in order as waypoints between depot and depot", () => {
    const [url, ...rest] = googleMapsDirectionsUrls({
      origin: "21 Industrial Dr, Braeside VIC 3195",
      destination: "21 Industrial Dr, Braeside VIC 3195",
      stops: ["14 Albert St, Brunswick VIC 3056", "7 Lennox St, Richmond VIC 3121"],
    });
    expect(rest).toEqual([]);
    expect(url!.startsWith("https://www.google.com/maps/dir/?api=1&")).toBe(true);
    const p = q(url!);
    expect(p.get("origin")).toBe("21 Industrial Dr, Braeside VIC 3195");
    expect(p.get("destination")).toBe("21 Industrial Dr, Braeside VIC 3195");
    expect(p.get("waypoints")).toBe(
      "14 Albert St, Brunswick VIC 3056|7 Lennox St, Richmond VIC 3121",
    );
    expect(p.get("travelmode")).toBe("driving");
    expect(url).toContain("%7C"); // pipe is encoded
  });

  it("starts from the phone's location when there's no origin, and accepts coordinates", () => {
    const [url] = googleMapsDirectionsUrls({ stops: [{ lat: -37.8, lng: 145.1 }, "B"] });
    const p = q(url!);
    expect(p.has("origin")).toBe(false);
    expect(p.get("waypoints")).toBe("-37.8,145.1");
    expect(p.get("destination")).toBe("B");
  });

  it("splits long days into several links of up to 9 waypoints", () => {
    const stops = Array.from({ length: 12 }, (_, i) => `S${i + 1}`);
    const urls = googleMapsDirectionsUrls({ origin: "Depot", destination: "Depot", stops });
    expect(urls).toHaveLength(2);
    const [a, b] = urls.map(q);
    expect(a!.get("origin")).toBe("Depot");
    expect(a!.get("waypoints")!.split("|")).toEqual(stops.slice(0, 9));
    expect(a!.get("destination")).toBe("S10");
    expect(b!.get("origin")).toBe("S10");
    expect(b!.get("waypoints")).toBe("S11|S12");
    expect(b!.get("destination")).toBe("Depot");
  });

  it("returns nothing for an empty day", () => {
    expect(googleMapsDirectionsUrls({ origin: "Depot", stops: [] })).toEqual([]);
  });
});

describe("static map", () => {
  it("labels markers 1–9 then A–Z", () => {
    expect(markerLabel(1)).toBe("1");
    expect(markerLabel(9)).toBe("9");
    expect(markerLabel(10)).toBe("A");
    expect(markerLabel(35)).toBe("Z");
    expect(markerLabel(36)).toBe("");
  });

  it("builds a Static Maps URL with the route and numbered markers", () => {
    const url = buildStaticMapUrl(
      {
        start: { lat: -37.99, lng: 145.117 },
        stops: [
          { point: { lat: -37.8, lng: 145.1 }, label: "1" },
          { point: { lat: -37.9, lng: 145.0 }, label: "2", fixed: true },
        ],
        path: [
          { lat: -37.99, lng: 145.117 },
          { lat: -37.8, lng: 145.1 },
          { lat: -37.9, lng: 145.0 },
          { lat: -37.99, lng: 145.117 },
        ],
      },
      "KEY",
      "http://mock/staticmap",
    );
    const p = q(url);
    expect(url.startsWith("http://mock/staticmap?")).toBe(true);
    expect(p.get("size")).toBe("640x400");
    expect(p.get("key")).toBe("KEY");
    expect(p.getAll("markers")).toEqual([
      "color:0x111827|label:H|-37.990000,145.117000",
      "color:0x2563eb|label:1|-37.800000,145.100000",
      "color:0xdc2626|label:2|-37.900000,145.000000",
    ]);
    expect(p.get("path")).toBe(
      "color:0x2563ebcc|weight:4|-37.990000,145.117000|-37.800000,145.100000|-37.900000,145.000000|-37.990000,145.117000",
    );
  });
});
