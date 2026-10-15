/**
 * Google OAuth 2.0 for the Calendar sync (web server flow: authorization code, offline
 * access so we get a refresh token). Pure request builders and parsers over plain fetch so
 * they can be unit-tested without reaching Google.
 * https://developers.google.com/identity/protocols/oauth2/web-server
 */

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_URL = "https://oauth2.googleapis.com";
export const GOOGLE_CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3";

/** calendar.events: create / change / delete events. openid email: which Google account. */
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";

type Env = Record<string, string | undefined>;
const clean = (v: string | undefined) => v?.trim() || undefined;
const trimSlash = (v: string) => v.replace(/\/$/, "");

export type GoogleConfig =
  | {
      configured: true;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      scopes: string[];
      /** Overridable for tests / a local mock server. Default to the real Google hosts. */
      authorizeUrl: string;
      oauthUrl: string;
      apiUrl: string;
    }
  | { configured: false; missing: string[] };

export type ConfiguredGoogle = Extract<GoogleConfig, { configured: true }>;

export function readGoogleConfig(env: Env): GoogleConfig {
  const clientId = clean(env.GOOGLE_CLIENT_ID);
  const clientSecret = clean(env.GOOGLE_CLIENT_SECRET);
  const missing = [!clientId && "GOOGLE_CLIENT_ID", !clientSecret && "GOOGLE_CLIENT_SECRET"].filter(
    Boolean,
  ) as string[];
  if (missing.length) return { configured: false, missing };
  const base = trimSlash(clean(env.APP_URL) ?? clean(env.AUTH_URL) ?? "http://localhost:3000");
  return {
    configured: true,
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: `${base}${GOOGLE_CALLBACK_PATH}`,
    scopes: GOOGLE_SCOPES,
    authorizeUrl: clean(env.GOOGLE_AUTHORIZE_URL) ?? GOOGLE_AUTHORIZE_URL,
    oauthUrl: trimSlash(clean(env.GOOGLE_OAUTH_URL) ?? GOOGLE_OAUTH_URL),
    apiUrl: trimSlash(clean(env.GOOGLE_CALENDAR_API_URL) ?? GOOGLE_CALENDAR_API_URL),
  };
}

/**
 * Google's consent screen. access_type=offline + prompt=consent make Google return a refresh
 * token every time (also when the user connected before), include_granted_scopes keeps any
 * other access the user already gave the app.
 */
export function buildAuthorizeUrl(
  config: ConfiguredGoogle,
  state: string,
  loginHint?: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `${config.authorizeUrl}?${params.toString()}`;
}

export interface HttpRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string>; body?: string };
}

/** Google takes the client credentials in the form body. */
export function buildTokenRequest(
  config: ConfiguredGoogle,
  grant: { code: string } | { refreshToken: string },
): HttpRequest {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...("code" in grant
      ? { grant_type: "authorization_code", code: grant.code, redirect_uri: config.redirectUri }
      : { grant_type: "refresh_token", refresh_token: grant.refreshToken }),
  });
  return {
    url: `${config.oauthUrl}/token`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    },
  };
}

/** Revoking the refresh token removes CoolOps's access to the Google account. */
export function buildRevokeRequest(config: ConfiguredGoogle, token: string): HttpRequest {
  return {
    url: `${config.oauthUrl}/revoke`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    },
  };
}

export interface GoogleTokenSet {
  accessToken: string;
  /** Only on the first exchange (and with prompt=consent); a refresh normally has none. */
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
  email: string | null;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    /** invalid_grant: the refresh token is dead (revoked, password changed…): reconnect. */
    readonly reconnect = false,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/**
 * The email claim of the id_token. It came straight from Google's token endpoint over TLS,
 * so it's read without verifying the signature (it's only shown, never trusted for access).
 */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

export async function parseTokenResponse(res: Response, now = new Date()): Promise<GoogleTokenSet> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (!res.ok || typeof json.access_token !== "string") {
    const code = typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
    throw new GoogleAuthError(
      code === "invalid_grant"
        ? "Google Calendar access has expired or was removed. Connect Google Calendar again."
        : `Google sign-in failed: ${code}`,
      code === "invalid_grant",
    );
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    scope: typeof json.scope === "string" ? json.scope : "",
    email: emailFromIdToken(json.id_token),
  };
}

/** True when the user didn't tick the calendar permission on Google's consent screen. */
export function missingCalendarScope(scope: string): boolean {
  if (!scope.trim()) return false; // Google didn't say: find out on the first API call
  const granted = scope.split(/\s+/);
  return ![
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar",
  ].some((s) => granted.includes(s));
}

/** Refresh when less than this is left (Google access tokens live an hour). */
export const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

export function tokenNeedsRefresh(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < TOKEN_REFRESH_MARGIN_MS;
}
