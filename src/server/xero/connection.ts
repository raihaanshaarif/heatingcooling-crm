import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { XeroApi } from "@/lib/xero/client";
import { decryptSecret, encryptSecret } from "@/lib/xero/crypto";
import {
  XeroAuthError,
  buildRevokeRequest,
  buildTokenRequest,
  parseConnections,
  parseTokenResponse,
  readXeroConfig,
  tokenNeedsRefresh,
  type XeroConfig,
  type XeroTenant,
  type XeroTokenSet,
} from "@/lib/xero/oauth";
import { resolveXeroSettings } from "@/lib/xero/settings";
import { getSettings } from "@/server/settings";

export const CONNECTION_ID = "singleton";

export function getXeroConfig(): XeroConfig {
  return readXeroConfig(process.env);
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new XeroAuthError("AUTH_SECRET is not set, so Xero tokens can't be stored.");
  return s;
}

export async function getXeroSettings() {
  const settings = await getSettings();
  return resolveXeroSettings(settings.xeroSettings);
}

export function getXeroConnection() {
  return db.xeroConnection.findUnique({ where: { id: CONNECTION_ID } });
}

export function storedTenants(json: Prisma.JsonValue | null | undefined): XeroTenant[] {
  return Array.isArray(json) ? (json as unknown as XeroTenant[]) : [];
}

/** Exchange the authorization code, list the organisations and store the (encrypted) tokens. */
export async function completeXeroConnection(code: string, userId: string) {
  const config = getXeroConfig();
  if (!config.configured) throw new XeroAuthError("Xero is not set up on the server.");
  const token = buildTokenRequest(config, { code });
  const tokens = await parseTokenResponse(await fetch(token.url, token.init));
  const res = await fetch(`${config.apiUrl}/connections`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new XeroAuthError(`Couldn't list Xero organisations (HTTP ${res.status}).`);
  const tenants = parseConnections(await res.json());
  if (tenants.length === 0) throw new XeroAuthError("No Xero organisation was authorised.");

  const existing = await getXeroConnection();
  // Keep the current organisation if it's still authorised; with only one, pick it.
  const keep = tenants.find((t) => t.tenantId === existing?.tenantId);
  const chosen = keep ?? (tenants.length === 1 ? tenants[0] : undefined);
  const data = {
    tenants: tenants as unknown as Prisma.InputJsonValue,
    tenantId: chosen?.tenantId ?? null,
    tenantName: chosen?.tenantName ?? null,
    accessTokenEnc: encryptSecret(tokens.accessToken, secret()),
    refreshTokenEnc: encryptSecret(tokens.refreshToken, secret()),
    accessTokenExpiry: tokens.expiresAt,
    scopes: tokens.scope,
    connectedById: userId,
    lastError: null,
  };
  const settings = await getSettings();
  await db.$transaction(async (tx) => {
    await tx.xeroConnection.upsert({
      where: { id: CONNECTION_ID },
      create: { id: CONNECTION_ID, ...data },
      update: data,
    });
    if (chosen) await resetIdsIfOrganisationChanged(tx, settings.xeroTenantId, chosen.tenantId);
  });
  return { tenants, chosen: chosen ?? null };
}

async function saveTokens(tokens: XeroTokenSet) {
  await db.xeroConnection.update({
    where: { id: CONNECTION_ID },
    data: {
      accessTokenEnc: encryptSecret(tokens.accessToken, secret()),
      refreshTokenEnc: encryptSecret(tokens.refreshToken, secret()),
      accessTokenExpiry: tokens.expiresAt,
      ...(tokens.scope ? { scopes: tokens.scope } : {}),
      lastError: null,
    },
  });
}

let refreshing: Promise<string> | null = null;

/**
 * A valid access token, refreshed when it's about to expire (or when force=true after a 401).
 * Refresh tokens rotate, so the new one is stored straight away. Concurrent callers in the
 * same process share one refresh.
 */
export async function getAccessToken(force = false): Promise<string> {
  const conn = await getXeroConnection();
  if (!conn) throw new XeroAuthError("Xero is not connected.", true);
  if (!force && !tokenNeedsRefresh(conn.accessTokenExpiry))
    return decryptSecret(conn.accessTokenEnc, secret());
  refreshing ??= (async () => {
    const config = getXeroConfig();
    if (!config.configured)
      throw new XeroAuthError("XERO_CLIENT_ID / XERO_CLIENT_SECRET are not set.");
    try {
      const req = buildTokenRequest(config, {
        refreshToken: decryptSecret(conn.refreshTokenEnc, secret()),
      });
      let res: Response;
      try {
        res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        throw new XeroAuthError(
          `Can't reach Xero to refresh the connection: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const tokens = await parseTokenResponse(res);
      await saveTokens(tokens);
      return tokens.accessToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.xeroConnection
        .update({ where: { id: CONNECTION_ID }, data: { lastError: message } })
        .catch(() => undefined);
      throw error;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** An API client for the chosen organisation, or null when Xero isn't fully connected. */
export async function getXeroApi(): Promise<XeroApi | null> {
  const config = getXeroConfig();
  const conn = await getXeroConnection();
  if (!config.configured || !conn?.tenantId) return null;
  return new XeroApi({ apiUrl: config.apiUrl, tenantId: conn.tenantId, getToken: getAccessToken });
}

/** Revoke the refresh token (which removes the app's access) and delete the stored tokens. */
export async function disconnectXero(): Promise<{ revoked: boolean; error?: string }> {
  const conn = await getXeroConnection();
  if (!conn) return { revoked: false };
  const config = getXeroConfig();
  let revoked = false;
  let error: string | undefined;
  if (config.configured) {
    try {
      const req = buildRevokeRequest(config, decryptSecret(conn.refreshTokenEnc, secret()));
      const res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(15_000) });
      revoked = res.ok;
      if (!res.ok) error = `Xero returned HTTP ${res.status} when revoking`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  await db.xeroConnection.delete({ where: { id: CONNECTION_ID } });
  return { revoked, error };
}

/**
 * Xero IDs on records belong to one organisation: when the organisation changes, forget
 * them and cancel waiting jobs. Records are pushed fresh when they next change or on Retry.
 */
export async function resetIdsIfOrganisationChanged(tx: Tx, previous: string | null, next: string) {
  if (previous && previous !== next) {
    const clear = { xeroSyncStatus: null, xeroSyncError: null, xeroSyncedAt: null };
    await tx.client.updateMany({ data: { xeroContactId: null, ...clear } });
    await tx.invoice.updateMany({ data: { xeroInvoiceId: null, ...clear } });
    await tx.payment.updateMany({ data: { xeroPaymentId: null, ...clear } });
    await tx.creditNote.updateMany({ data: { xeroCreditNoteId: null, ...clear } });
    await tx.xeroSyncJob.updateMany({
      where: { status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
      data: { status: "CANCELLED", lastError: "Switched to another Xero organisation" },
    });
  }
  await tx.businessSettings.update({ where: { id: "singleton" }, data: { xeroTenantId: next } });
}
