import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/utils";
import { audit } from "@/server/audit";
import { completeXeroConnection } from "@/server/xero/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "xero_oauth_state";

function back(params: Record<string, string>) {
  const res = NextResponse.redirect(
    appUrl(`/integrations?${new URLSearchParams(params).toString()}`),
  );
  res.cookies.delete({ name: STATE_COOKIE, path: "/api/integrations/xero" });
  return res;
}

function sameState(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Xero redirects here ({APP_URL}/api/integrations/xero/callback) after the admin consents. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user, "update", "settings")) return back({ xero: "forbidden" });
  const search = req.nextUrl.searchParams;
  const error = search.get("error");
  if (error)
    return back({
      xero: "error",
      reason: error === "access_denied" ? "You cancelled in Xero." : error,
    });
  if (!sameState(search.get("state"), req.cookies.get(STATE_COOKIE)?.value))
    return back({ xero: "error", reason: "The sign-in link expired. Please try Connect again." });
  const code = search.get("code");
  if (!code) return back({ xero: "error", reason: "Xero didn't send an authorisation code." });
  try {
    const { tenants, chosen } = await completeXeroConnection(code, user.id);
    await audit(db, {
      userId: user.id,
      action: "XERO_CONNECT",
      entityType: "SETTINGS",
      entityId: "xero",
      changes: { organisations: tenants.map((t) => t.tenantName), chosen: chosen?.tenantName },
    });
    return back({ xero: chosen ? "connected" : "choose" });
  } catch (e) {
    console.error("[xero] connect failed", e);
    return back({ xero: "error", reason: e instanceof Error ? e.message : "Connection failed." });
  }
}
