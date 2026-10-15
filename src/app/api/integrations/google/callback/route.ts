import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/utils";
import { audit } from "@/server/audit";
import { completeGoogleConnection } from "@/server/google-calendar/connection";
import { kickCalendarSync, queueUserResync } from "@/server/google-calendar/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

function back(params: Record<string, string>) {
  const res = NextResponse.redirect(appUrl(`/account?${new URLSearchParams(params).toString()}`));
  res.cookies.delete({ name: STATE_COOKIE, path: "/api/integrations/google" });
  return res;
}

function sameState(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Google redirects here ({APP_URL}/api/integrations/google/callback) after the user consents. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));
  const search = req.nextUrl.searchParams;
  const error = search.get("error");
  if (error)
    return back({
      google: "error",
      reason: error === "access_denied" ? "You cancelled on Google's screen." : error,
    });
  if (!sameState(search.get("state"), req.cookies.get(STATE_COOKIE)?.value))
    return back({ google: "error", reason: "The sign-in link expired. Please try Connect again." });
  const code = search.get("code");
  if (!code) return back({ google: "error", reason: "Google didn't send an authorisation code." });
  try {
    const { email, switchedAccount } = await completeGoogleConnection(code, user.id);
    await queueUserResync(db, user.id, true);
    await audit(db, {
      userId: user.id,
      action: "GOOGLE_CALENDAR_CONNECT",
      entityType: "USER",
      entityId: user.id,
      changes: { googleEmail: email, switchedAccount },
    });
    kickCalendarSync();
    return back({ google: "connected" });
  } catch (e) {
    console.error("[google-calendar] connect failed", e);
    return back({ google: "error", reason: e instanceof Error ? e.message : "Connection failed." });
  }
}
