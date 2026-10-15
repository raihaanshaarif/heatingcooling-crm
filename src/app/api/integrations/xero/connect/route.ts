import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { appUrl } from "@/lib/utils";
import { buildAuthorizeUrl } from "@/lib/xero/oauth";
import { getXeroConfig } from "@/server/xero/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XERO_STATE_COOKIE = "xero_oauth_state";

/** Admin clicks "Connect to Xero": send them to Xero's consent screen with a CSRF state. */
export async function GET() {
  const user = await getCurrentUser();
  if (!can(user, "update", "settings"))
    return NextResponse.redirect(appUrl("/integrations?xero=forbidden"));
  const config = getXeroConfig();
  if (!config.configured) return NextResponse.redirect(appUrl("/integrations?xero=not-set-up"));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(buildAuthorizeUrl(config, state));
  res.cookies.set(XERO_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // sent on Xero's top-level redirect back to us
    secure: appUrl().startsWith("https://"),
    path: "/api/integrations/xero",
    maxAge: 600,
  });
  return res;
}
