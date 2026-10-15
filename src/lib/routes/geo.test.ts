import { describe, expect, it } from "vitest";
import { estimateMatrix, estimateTravel, haversineKm, isValidLatLng, toLatLng } from "./geo";
import { suburbCentre } from "./suburbs";

const CBD = { lat: -37.8136, lng: 144.9631 };
const BOX_HILL = { lat: -37.8189, lng: 145.1218 };

describe("haversine and estimates", () => {
  it("measures straight-line distance in km", () => {
    expect(haversineKm(CBD, CBD)).toBe(0);
    // Melbourne CBD → Box Hill is about 14 km as the crow flies.
    expect(haversineKm(CBD, BOX_HILL)).toBeGreaterThan(13.5);
    expect(haversineKm(CBD, BOX_HILL)).toBeLessThan(14.5);
    // Melbourne → Sydney ≈ 714 km.
    expect(haversineKm(CBD, { lat: -33.8688, lng: 151.2093 })).toBeCloseTo(714, -1);
    expect(haversineKm(CBD, BOX_HILL)).toBeCloseTo(haversineKm(BOX_HILL, CBD), 9);
  });

  it("estimates drive distance × 1.3 at 40 km/h, rounding minutes up", () => {
    const straight = haversineKm(CBD, BOX_HILL);
    const t = estimateTravel(CBD, BOX_HILL);
    expect(t.km).toBeCloseTo(straight * 1.3, 1);
    expect(t.minutes).toBe(Math.ceil(((straight * 1.3) / 40) * 60));
    expect(estimateTravel(CBD, BOX_HILL, { roadFactor: 1, speedKmh: 60 }).minutes).toBe(
      Math.ceil((straight / 60) * 60),
    );
    expect(estimateTravel(CBD, CBD)).toEqual({ km: 0, minutes: 0 });
  });

  it("builds a matrix where unknown points cost nothing", () => {
    const m = estimateMatrix([null, CBD, BOX_HILL, null]);
    expect(m.minutes[0]).toEqual([0, 0, 0, 0]);
    expect(m.minutes[1]![2]).toBe(estimateTravel(CBD, BOX_HILL).minutes);
    expect(m.km[2]![1]).toBe(m.km[1]![2]);
    expect(m.minutes[3]![1]).toBe(0);
  });

  it("validates coordinates", () => {
    expect(isValidLatLng({ lat: -37.8, lng: 145 })).toBe(true);
    expect(isValidLatLng({ lat: null, lng: 145 })).toBe(false);
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(toLatLng({ lat: Number.NaN, lng: 1 })).toBeNull();
    expect(toLatLng({ lat: -37.8, lng: 145 })).toEqual({ lat: -37.8, lng: 145 });
  });

  it("knows Melbourne suburb centres", () => {
    expect(suburbCentre("box hill")).toEqual({ lat: -37.8189, lng: 145.1218 });
    expect(suburbCentre(" Mt Waverley ")).toEqual(suburbCentre("Mount Waverley"));
    expect(suburbCentre("Atlantis")).toBeNull();
    expect(suburbCentre(null)).toBeNull();
  });
});
