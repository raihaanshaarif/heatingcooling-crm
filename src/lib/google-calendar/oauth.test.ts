import { describe, expect, it } from "vitest";
import {
  GoogleAuthError,
  buildAuthorizeUrl,
  buildRevokeRequest,
  buildTokenRequest,
  emailFromIdToken,
  missingCalendarScope,
  parseTokenResponse,
  readGoogleConfig,
  tokenNeedsRefresh,
} from "./oauth";

const env = {
  GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-secret",
  APP_URL: "https://app.coolingservicemelbourne.com.au/",
};

function configured() {
  const c = readGoogleConfig(env);
  if (!c.configured) throw new Error("expected configured");
  return c;
}

const idToken = (claims: object) =>
  `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

describe("readGoogleConfig", () => {
  it("is not set up without both keys", () => {
    expect(readGoogleConfig({})).toEqual({
      configured: false,
      missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    });
    expect(readGoogleConfig({ GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: " " })).toEqual({
      configured: false,
      missing: ["GOOGLE_CLIENT_SECRET"],
    });
  });

  it("builds the redirect URI from APP_URL and defaults to the real Google hosts", () => {
    const c = configured();
    expect(c.redirectUri).toBe(
      "https://app.coolingservicemelbourne.com.au/api/integrations/google/callback",
    );
    expect(c.authorizeUrl).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(c.oauthUrl).toBe("https://oauth2.googleapis.com");
    expect(c.apiUrl).toBe("https://www.googleapis.com/calendar/v3");
  });

  it("lets tests point at a mock server", () => {
    const c = readGoogleConfig({
      ...env,
      GOOGLE_AUTHORIZE_URL: "http://localhost:4100/auth",
      GOOGLE_OAUTH_URL: "http://localhost:4100/",
      GOOGLE_CALENDAR_API_URL: "http://localhost:4100/calendar/v3/",
    });
    expect(c).toMatchObject({
      authorizeUrl: "http://localhost:4100/auth",
      oauthUrl: "http://localhost:4100",
      apiUrl: "http://localhost:4100/calendar/v3",
    });
  });
});

describe("buildAuthorizeUrl", () => {
  it("asks for offline access with consent, calendar.events and the email", () => {
    const url = new URL(buildAuthorizeUrl(configured(), "state-123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "123-abc.apps.googleusercontent.com",
      redirect_uri: "https://app.coolingservicemelbourne.com.au/api/integrations/google/callback",
      response_type: "code",
      scope: "openid email https://www.googleapis.com/auth/calendar.events",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: "state-123",
    });
  });

  it("suggests the account already connected when reconnecting", () => {
    const url = new URL(buildAuthorizeUrl(configured(), "s", "sam@gmail.com"));
    expect(url.searchParams.get("login_hint")).toBe("sam@gmail.com");
  });
});

describe("token requests", () => {
  it("exchanges the code with the client credentials in the body", () => {
    const req = buildTokenRequest(configured(), { code: "4/0Ab" });
    expect(req.url).toBe("https://oauth2.googleapis.com/token");
    expect(req.init.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(req.init.body))).toEqual({
      client_id: "123-abc.apps.googleusercontent.com",
      client_secret: "GOCSPX-secret",
      grant_type: "authorization_code",
      code: "4/0Ab",
      redirect_uri: "https://app.coolingservicemelbourne.com.au/api/integrations/google/callback",
    });
  });

  it("refreshes with the refresh token", () => {
    const body = new URLSearchParams(
      buildTokenRequest(configured(), { refreshToken: "1//rt" }).init.body,
    );
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("1//rt");
    expect(body.get("redirect_uri")).toBeNull();
  });

  it("revokes the token", () => {
    const req = buildRevokeRequest(configured(), "1//rt");
    expect(req.url).toBe("https://oauth2.googleapis.com/revoke");
    expect(req.init.body).toBe("token=1%2F%2Frt");
  });
});

describe("parseTokenResponse", () => {
  const now = new Date("2026-10-15T00:00:00Z");

  it("reads tokens, expiry and the Google account email", async () => {
    const res = Response.json({
      access_token: "ya29.a",
      refresh_token: "1//r",
      expires_in: 3599,
      scope: "openid https://www.googleapis.com/auth/calendar.events email",
      id_token: idToken({ email: "sam@gmail.com", sub: "1" }),
    });
    expect(await parseTokenResponse(res, now)).toEqual({
      accessToken: "ya29.a",
      refreshToken: "1//r",
      expiresAt: new Date(now.getTime() + 3599_000),
      scope: "openid https://www.googleapis.com/auth/calendar.events email",
      email: "sam@gmail.com",
    });
  });

  it("has no refresh token on a refresh", async () => {
    const t = await parseTokenResponse(Response.json({ access_token: "ya29.b", expires_in: 3600 }));
    expect(t.refreshToken).toBeNull();
    expect(t.email).toBeNull();
  });

  it("flags a dead refresh token as needing a reconnect", async () => {
    const res = Response.json({ error: "invalid_grant" }, { status: 400 });
    const error = await parseTokenResponse(res).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error).toMatchObject({ reconnect: true });
  });

  it("reports other errors", async () => {
    await expect(parseTokenResponse(new Response("<html>", { status: 500 }))).rejects.toMatchObject(
      { message: "Google sign-in failed: HTTP 500", reconnect: false },
    );
  });
});

describe("helpers", () => {
  it("reads the email from an id_token and ignores junk", () => {
    expect(emailFromIdToken(idToken({ email: "a@b.com" }))).toBe("a@b.com");
    expect(emailFromIdToken("nope")).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
  });

  it("notices when the calendar box was unticked", () => {
    expect(missingCalendarScope("openid email")).toBe(true);
    expect(missingCalendarScope("openid https://www.googleapis.com/auth/calendar.events")).toBe(
      false,
    );
    expect(missingCalendarScope("https://www.googleapis.com/auth/calendar")).toBe(false);
    expect(missingCalendarScope("")).toBe(false);
  });

  it("refreshes two minutes before expiry", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(tokenNeedsRefresh(new Date(now.getTime() + 60_000), now)).toBe(true);
    expect(tokenNeedsRefresh(new Date(now.getTime() + 10 * 60_000), now)).toBe(false);
  });
});
