import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getMapsConfig } from "@/lib/routes/config";
import { buildStaticMapUrl } from "@/lib/routes/maps-url";
import type { LatLng } from "@/lib/routes/geo";
import { isValidLatLng } from "@/lib/routes/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePoint(value: string | null): LatLng | null {
  if (!value) return null;
  const [lat, lng] = value.split(",").map(Number);
  const p = { lat: lat!, lng: lng! };
  return isValidLatLng(p) ? p : null;
}

/**
 * Route map image for the planner. Fetches Google Static Maps on the server so the API key
 * never reaches the browser. Only when GOOGLE_MAPS_API_KEY is set (otherwise the planner
 * draws its own map and never calls this).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !can(user, "update", "routes"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const config = getMapsConfig();
  if (!config.apiKey)
    return NextResponse.json({ error: "Google Maps not set up" }, { status: 404 });
  const url = new URL(req.url);
  const start = parsePoint(url.searchParams.get("s"));
  const stops = url.searchParams
    .getAll("p")
    .slice(0, 40)
    .map((raw) => {
      const [lat, lng, label, fixed] = raw.split(",");
      const point = parsePoint(`${lat},${lng}`);
      return point
        ? { point, label: /^[0-9A-Z]$/.test(label ?? "") ? label! : "", fixed: fixed === "1" }
        : null;
    })
    .filter((s): s is NonNullable<typeof s> => !!s);
  if (!stops.length) return NextResponse.json({ error: "No stops" }, { status: 400 });
  const path = [...(start ? [start] : []), ...stops.map((s) => s.point), ...(start ? [start] : [])];
  const res = await fetch(
    buildStaticMapUrl({ start, stops, path }, config.apiKey, config.staticMapUrl),
    { signal: AbortSignal.timeout(15_000) },
  ).catch(() => null);
  if (!res || !res.ok) {
    console.error("[maps] static map failed", res?.status);
    return NextResponse.json({ error: "Map unavailable" }, { status: 502 });
  }
  return new NextResponse(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
