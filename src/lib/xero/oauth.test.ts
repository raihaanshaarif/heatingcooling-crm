import { describe, expect, it } from "vitest";
import {
  DEFAULT_XERO_SCOPES,
  XeroAuthError,
  buildAuthorizeUrl,
  buildRevokeRequest,
  buildTokenRequest,
  parseConnections,
  parseTokenResponse,
  readXeroConfig,
  tokenNeedsRefresh,
} from "./oauth";

const env = {
  XERO_CLIENT_ID: "CLIENT123",
  XERO_CLIENT_SECRET: "s3cret",
  APP_URL: "https://app.coolingservicemelbourne.com.au/",
};

function configured() {
  const config = readXeroConfig(env);
  if (!config.configured) throw new Error("expected configured");
  return config;
}

describe("readXeroConfig", () => {
  it("lists missing variables", () => {
    expect(readXeroConfig({})).toEqual({
      configured: false,
      missing: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"],
    });
    expect(readXeroConfig({ XERO_CLIENT_ID: "x", XERO_CLIENT_SECRET: "  " })).toEqual({
      configured: false,
      missing: ["XERO_CLIENT_SECRET"],
    });
  });

  it("builds the redirect URI from APP_URL and uses the default scopes", () => {
    const config = configured();
    expect(config.redirectUri).toBe(
      "https://app.coolingservicemelbourne.com.au/api/integrations/xero/callback",
    );
    expect(config.scopes).toEqual(DEFAULT_XERO_SCOPES);
    expect(config.apiUrl).toBe("https://api.xero.com");
    expect(config.identityUrl).toBe("https://identity.xero.com");
  });

  it("allows scopes and hosts to be overridden", () => {
    const config = readXeroConfig({
      ...env,
      XERO_SCOPES: "offline_access accounting.invoices",
      XERO_API_URL: "http://localhost:9999/",
    });
    expect(config.configured && config.scopes).toEqual(["offline_access", "accounting.invoices"]);
    expect(config.configured && config.apiUrl).toBe("http://localhost:9999");
  });
});

describe("buildAuthorizeUrl", () => {
  it("is a standard authorization code request", () => {
    const url = new URL(buildAuthorizeUrl(configured(), "state-abc"));
    expect(url.origin + url.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "CLIENT123",
      redirect_uri: "https://app.coolingservicemelbourne.com.au/api/integrations/xero/callback",
      scope: "offline_access accounting.transactions accounting.contacts accounting.settings.read",
      state: "state-abc",
    });
  });
});

describe("token requests", () => {
  const basic = `Basic ${Buffer.from("CLIENT123:s3cret").toString("base64")}`;

  it("exchanges an authorization code", () => {
    const req = buildTokenRequest(configured(), { code: "the-code" });
    expect(req.url).toBe("https://identity.xero.com/connect/token");
    expect(req.init.method).toBe("POST");
    expect(req.init.headers.Authorization).toBe(basic);
    expect(Object.fromEntries(new URLSearchParams(req.init.body))).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "https://app.coolingservicemelbourne.com.au/api/integrations/xero/callback",
    });
  });

  it("refreshes and revokes with the refresh token", () => {
    const refresh = buildTokenRequest(configured(), { refreshToken: "rt-1" });
    expect(Object.fromEntries(new URLSearchParams(refresh.init.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "rt-1",
    });
    const revoke = buildRevokeRequest(configured(), "rt-1");
    expect(revoke.url).toBe("https://identity.xero.com/connect/revocation");
    expect(revoke.init.body).toBe("token=rt-1");
    expect(revoke.init.headers.Authorization).toBe(basic);
  });

  it("parses a token response", async () => {
    const now = new Date("2026-10-15T00:00:00Z");
    const res = new Response(
      JSON.stringify({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 1800,
        scope: "offline_access accounting.transactions",
      }),
      { status: 200 },
    );
    expect(await parseTokenResponse(res, now)).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date("2026-10-15T00:30:00Z"),
      scope: "offline_access accounting.transactions",
    });
  });

  it("flags a dead refresh token so the admin is asked to reconnect", async () => {
    const res = new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    const error = await parseTokenResponse(res).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XeroAuthError);
    expect((error as XeroAuthError).reconnect).toBe(true);
    expect((error as XeroAuthError).message).toMatch(/Reconnect Xero/);
  });

  it("knows when a token needs refreshing", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(tokenNeedsRefresh(new Date("2026-10-15T00:10:00Z"), now)).toBe(false);
    expect(tokenNeedsRefresh(new Date("2026-10-15T00:01:00Z"), now)).toBe(true);
    expect(tokenNeedsRefresh(new Date("2026-10-14T23:00:00Z"), now)).toBe(true);
  });
});

describe("parseConnections", () => {
  it("keeps organisations only", () => {
    expect(
      parseConnections([
        {
          id: "c1",
          tenantId: "t1",
          tenantType: "ORGANISATION",
          tenantName: "Cooling Service Melbourne",
        },
        { id: "c2", tenantId: "t2", tenantType: "PRACTICEMANAGER", tenantName: "XPM" },
        { nonsense: true },
      ]),
    ).toEqual([{ connectionId: "c1", tenantId: "t1", tenantName: "Cooling Service Melbourne" }]);
    expect(parseConnections({ not: "a list" })).toEqual([]);
  });
});
