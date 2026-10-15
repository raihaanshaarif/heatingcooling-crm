/**
 * Xero OAuth 2.0 (standard authorization code flow) over plain fetch. Pure request
 * builders and response parsers so they can be unit-tested without reaching Xero.
 * https://developer.xero.com/documentation/guides/oauth2/auth-flow
 */

export const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
export const XERO_IDENTITY_URL = "https://identity.xero.com";
export const XERO_API_URL = "https://api.xero.com";

/** accounting.settings.read lists the chart of accounts and tax rates for the settings form. */
export const DEFAULT_XERO_SCOPES = [
  "offline_access",
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings.read",
];

export const XERO_CALLBACK_PATH = "/api/integrations/xero/callback";

type Env = Record<string, string | undefined>;
const clean = (v: string | undefined) => v?.trim() || undefined;

export type XeroConfig =
  | {
      configured: true;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      scopes: string[];
      /** Overridable for tests / a local mock server. Defaults to the real Xero hosts. */
      identityUrl: string;
      apiUrl: string;
    }
  | { configured: false; missing: string[] };

export function readXeroConfig(env: Env): XeroConfig {
  const clientId = clean(env.XERO_CLIENT_ID);
  const clientSecret = clean(env.XERO_CLIENT_SECRET);
  const missing = [!clientId && "XERO_CLIENT_ID", !clientSecret && "XERO_CLIENT_SECRET"].filter(
    Boolean,
  ) as string[];
  if (missing.length) return { configured: false, missing };
  const base = (clean(env.APP_URL) ?? clean(env.AUTH_URL) ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const scopes =
    clean(env.XERO_SCOPES)
      ?.split(/[\s,]+/)
      .filter(Boolean) ?? DEFAULT_XERO_SCOPES;
  return {
    configured: true,
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: `${base}${XERO_CALLBACK_PATH}`,
    scopes,
    identityUrl: (clean(env.XERO_IDENTITY_URL) ?? XERO_IDENTITY_URL).replace(/\/$/, ""),
    apiUrl: (clean(env.XERO_API_URL) ?? XERO_API_URL).replace(/\/$/, ""),
  };
}

type Configured = Extract<XeroConfig, { configured: true }>;

export function buildAuthorizeUrl(config: Configured, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state,
  });
  return `${XERO_AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuth(config: Configured) {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

export interface HttpRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string>; body?: string };
}

export function buildTokenRequest(
  config: Configured,
  grant: { code: string } | { refreshToken: string },
): HttpRequest {
  const body =
    "code" in grant
      ? new URLSearchParams({
          grant_type: "authorization_code",
          code: grant.code,
          redirect_uri: config.redirectUri,
        })
      : new URLSearchParams({ grant_type: "refresh_token", refresh_token: grant.refreshToken });
  return {
    url: `${config.identityUrl}/connect/token`,
    init: {
      method: "POST",
      headers: {
        Authorization: basicAuth(config),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    },
  };
}

export function buildRevokeRequest(config: Configured, refreshToken: string): HttpRequest {
  return {
    url: `${config.identityUrl}/connect/revocation`,
    init: {
      method: "POST",
      headers: {
        Authorization: basicAuth(config),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    },
  };
}

export interface XeroTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

export class XeroAuthError extends Error {
  constructor(
    message: string,
    /** invalid_grant: the refresh token is dead (revoked, expired after 60 days unused…). */
    readonly reconnect = false,
  ) {
    super(message);
    this.name = "XeroAuthError";
  }
}

export async function parseTokenResponse(res: Response, now = new Date()): Promise<XeroTokenSet> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (!res.ok || typeof json.access_token !== "string") {
    const code = typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
    throw new XeroAuthError(
      code === "invalid_grant"
        ? "Xero connection has expired or was revoked. Reconnect Xero."
        : `Xero sign-in failed: ${code}`,
      code === "invalid_grant",
    );
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 1800;
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : "",
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    scope: typeof json.scope === "string" ? json.scope : "",
  };
}

export interface XeroTenant {
  connectionId: string;
  tenantId: string;
  tenantName: string;
}

/** GET {api}/connections → the organisations this token can reach. */
export function parseConnections(json: unknown): XeroTenant[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter(
      (c): c is { id: string; tenantId: string; tenantName?: string; tenantType?: string } =>
        !!c &&
        typeof (c as { tenantId?: unknown }).tenantId === "string" &&
        ((c as { tenantType?: string }).tenantType ?? "ORGANISATION") === "ORGANISATION",
    )
    .map((c) => ({
      connectionId: c.id,
      tenantId: c.tenantId,
      tenantName: c.tenantName || "Xero organisation",
    }));
}

/** Token is refreshed when it has less than this left (Xero access tokens live 30 minutes). */
export const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

export function tokenNeedsRefresh(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < TOKEN_REFRESH_MARGIN_MS;
}
