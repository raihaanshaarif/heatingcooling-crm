import "server-only";
import { db } from "@/lib/db";
import { getMapsConfig } from "@/lib/routes/config";
import { getSettings } from "@/server/settings";

/** Integrations card / Settings → Routes: provider, depot and how many addresses are located. */
export async function getRouteOverview() {
  const [settings, bySource, missing, failed] = await Promise.all([
    getSettings(),
    db.property.groupBy({ by: ["geocodeSource"], where: { lat: { not: null } }, _count: true }),
    db.property.count({ where: { lat: null } }),
    db.property.count({ where: { lat: null, geocodeError: { not: null } } }),
  ]);
  const count = (s: string | null) => bySource.find((b) => b.geocodeSource === s)?._count ?? 0;
  const located = bySource.reduce((sum, b) => sum + b._count, 0);
  return {
    googleConfigured: getMapsConfig().configured,
    located,
    google: count("GOOGLE"),
    approximate: count("SUBURB"),
    seeded: count("SEED") + count(null),
    missing,
    failed,
    depot: {
      address: settings.addressLine1,
      located: settings.depotLat !== null && settings.depotLng !== null,
      source: settings.depotGeocodeSource,
      error: settings.depotGeocodeError,
    },
    dayStart: settings.routeDayStart,
  };
}
