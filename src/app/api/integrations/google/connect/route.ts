import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { buildAuthorizeUrl } from "@/lib/google-calendar/oauth";
import { appUrl } from "@/lib/utils";
import { getCalendarConnection, getGoogleConfig } from "@/server/google-calendar/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

/** "Connect Google Calendar" on My account: off to Google's consent screen with a CSRF state. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));
  const config = getGoogleConfig();
  if (!config.configured) return NextResponse.redirect(appUrl("/account?google=not-set-up"));
  const existing = await getCalendarConnection(user.id);
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(
    buildAuthorizeUrl(config, state, existing?.googleEmail ?? undefined),
  );
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // sent on Google's top-level redirect back to us
    secure: appUrl().startsWith("https://"),
    path: "/api/integrations/google",
    maxAge: 600,
  });
  return res;
}
