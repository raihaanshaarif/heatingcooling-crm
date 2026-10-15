import "server-only";
import { after } from "next/server";
import type { GeocodeSource, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatAddress } from "@/lib/utils";
import { getMapsConfig } from "@/lib/routes/config";
import { GoogleMapsApi, GoogleMapsError } from "@/lib/routes/google";
import { suburbCentre } from "@/lib/routes/suburbs";

export type LocateResult =
  | { ok: true; lat: number; lng: number; source: GeocodeSource; note: string | null }
  | { ok: false; error: string; retryable: boolean };

function mapsApi() {
  const config = getMapsConfig();
  if (!config.apiKey) return null;
  return new GoogleMapsApi({
    apiKey: config.apiKey,
    geocodeUrl: config.geocodeUrl,
    routeMatrixUrl: config.routeMatrixUrl,
  });
}

/**
 * Find an address on the map. With GOOGLE_MAPS_API_KEY: Google Geocoding (Australia only),
 * falling back to the suburb centre when Google can't find the street. Without a key the
 * Google API is never called: the suburb centre from the built-in Melbourne list is used
 * (approximate) and the call is logged.
 */
export async function locateAddress(
  address: string,
  suburb?: string | null,
): Promise<LocateResult> {
  const api = mapsApi();
  const centre = suburbCentre(suburb);
  if (!api) {
    console.info(
      `[maps:dev] GOOGLE_MAPS_API_KEY not set, not calling Google. ${centre ? `Placing "${address}" at the centre of ${suburb}.` : `Can't place "${address}" (suburb not in the built-in list).`}`,
    );
    return centre
      ? { ok: true, ...centre, source: "SUBURB", note: null }
      : {
          ok: false,
          error: "Suburb not in the built-in list. Add GOOGLE_MAPS_API_KEY to look up any address.",
          retryable: false,
        };
  }
  try {
    const result = await api.geocode(address);
    if (result.ok)
      return { ok: true, lat: result.lat, lng: result.lng, source: "GOOGLE", note: null };
    if (centre)
      return {
        ok: true,
        ...centre,
        source: "SUBURB",
        note: "Google Maps couldn't find the street, so it's placed at the suburb centre.",
      };
    return { ok: false, error: result.message, retryable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[maps] geocoding failed", message);
    return {
      ok: false,
      error: message,
      retryable: error instanceof GoogleMapsError ? error.retryable : true,
    };
  }
}

const propertySelect = {
  id: true,
  addressLine1: true,
  addressLine2: true,
  suburb: true,
  state: true,
  postcode: true,
} satisfies Prisma.PropertySelect;

/** Geocode one property and store the result. */
export async function geocodeProperty(id: string) {
  const p = await db.property.findUnique({ where: { id }, select: propertySelect });
  if (!p) return null;
  const result = await locateAddress(`${formatAddress(p)}, Australia`, p.suburb);
  await db.property.update({
    where: { id },
    data: result.ok
      ? {
          lat: result.lat,
          lng: result.lng,
          geocodeSource: result.source,
          geocodedAt: new Date(),
          geocodeError: result.note,
        }
      : { geocodedAt: new Date(), geocodeError: result.error },
  });
  return result;
}

/** Geocode a property only if it isn't on the map yet (and hasn't been tried). */
export async function geocodePropertyIfMissing(id: string) {
  const p = await db.property.findUnique({
    where: { id },
    select: { lat: true, geocodedAt: true },
  });
  if (!p || p.lat !== null || p.geocodedAt) return null;
  return geocodeProperty(id);
}

export interface BackfillSummary {
  checked: number;
  located: number;
  approximate: number;
  failed: number;
  remaining: number;
  usedGoogle: boolean;
}

/**
 * Locate properties that aren't on the map yet. With Google set up, properties that were
 * only placed at their suburb centre (before the key was added) are looked up again too.
 * The daily cron skips addresses that failed in the last 7 days; the button retries them.
 */
export async function geocodeMissingProperties(
  options: { limit?: number; retryFailed?: boolean } = {},
): Promise<BackfillSummary> {
  const usedGoogle = getMapsConfig().configured;
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
  const where: Prisma.PropertyWhereInput = {
    OR: [
      {
        lat: null,
        ...(options.retryFailed
          ? {}
          : { OR: [{ geocodedAt: null }, { geocodedAt: { lt: weekAgo } }] }),
      },
      ...(usedGoogle
        ? [
            {
              geocodeSource: "SUBURB" as const,
              ...(options.retryFailed ? {} : { geocodeError: null }),
            },
          ]
        : []),
    ],
  };
  const todo = await db.property.findMany({
    where,
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 200,
  });
  const summary: BackfillSummary = {
    checked: todo.length,
    located: 0,
    approximate: 0,
    failed: 0,
    remaining: 0,
    usedGoogle,
  };
  for (const { id } of todo) {
    const r = await geocodeProperty(id);
    if (!r || !r.ok) summary.failed += 1;
    else if (r.source === "GOOGLE") summary.located += 1;
    else summary.approximate += 1;
    if (r && !r.ok && r.retryable && usedGoogle) break; // rate limited / Google down: stop for now
  }
  summary.remaining = await db.property.count({ where: { lat: null } });
  return summary;
}

/** Geocode the business address (Settings → Business) as the depot. */
export async function geocodeDepot() {
  const s = await db.businessSettings.findUnique({ where: { id: "singleton" } });
  if (!s) return null;
  if (!s.addressLine1 || !s.suburb) {
    await db.businessSettings.update({
      where: { id: "singleton" },
      data: {
        depotLat: null,
        depotLng: null,
        depotGeocodeSource: null,
        depotGeocodeError: "Add the business address under Settings → Business.",
      },
    });
    return null;
  }
  const address = `${formatAddress({ ...s, postcode: s.postcode ?? undefined })}, Australia`;
  const r = await locateAddress(address, s.suburb);
  await db.businessSettings.update({
    where: { id: "singleton" },
    data: r.ok
      ? {
          depotLat: r.lat,
          depotLng: r.lng,
          depotGeocodeSource: r.source,
          depotGeocodeError: r.note,
        }
      : { depotGeocodeError: r.error },
  });
  return r;
}

/** Geocode a technician's home address (Team → technician → Route start). */
export async function geocodeUserHome(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { homeAddress: true } });
  if (!u?.homeAddress) return null;
  // The suburb is usually the part before "VIC" / the postcode: "12 Smith St, Box Hill VIC 3128".
  const parts = u.homeAddress.split(",").map((x) => x.trim());
  const suburb = (parts[1] ?? parts[0] ?? "").replace(/\b(VIC|Victoria)\b.*$/i, "").trim();
  const r = await locateAddress(`${u.homeAddress}, Australia`, suburb);
  await db.user.update({
    where: { id: userId },
    data: r.ok
      ? { homeLat: r.lat, homeLng: r.lng, homeGeocodeSource: r.source }
      : { homeLat: null, homeLng: null, homeGeocodeSource: null },
  });
  return r;
}

/**
 * Run geocoding after the response has been sent (non-blocking), like the other outboxes.
 * Outside a request (scripts, tests) it runs straight away in the background.
 */
export function kickGeocode(task: () => Promise<unknown>) {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.error("[maps] background geocoding failed", error);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Daily cron: locate new or changed addresses that weren't located yet, and the depot. */
export async function runGeocodeCron() {
  const s = await db.businessSettings.findUnique({ where: { id: "singleton" } });
  if (s && s.depotLat === null && s.addressLine1) await geocodeDepot();
  return geocodeMissingProperties({ limit: 200 });
}
