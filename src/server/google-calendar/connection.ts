import "server-only";
import { db } from "@/lib/db";
import { SecretDecryptError, decryptSecret, encryptSecret } from "@/lib/crypto";
import { GoogleCalendarApi } from "@/lib/google-calendar/client";
import {
  GoogleAuthError,
  buildRevokeRequest,
  buildTokenRequest,
  missingCalendarScope,
  parseTokenResponse,
  readGoogleConfig,
  tokenNeedsRefresh,
  type GoogleConfig,
  type GoogleTokenSet,
} from "@/lib/google-calendar/oauth";

/** HKDF context for these tokens (each integration has its own key). */
const CRYPTO_CONTEXT = "coolops-google-calendar-tokens";

export function getGoogleConfig(): GoogleConfig {
  return readGoogleConfig(process.env);
}

export function isGoogleCalendarConfigured(): boolean {
  return getGoogleConfig().configured;
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new GoogleAuthError("AUTH_SECRET is not set, so Google tokens can't be stored.");
  return s;
}

const encrypt = (v: string) => encryptSecret(v, secret(), CRYPTO_CONTEXT);
function decrypt(v: string) {
  try {
    return decryptSecret(v, secret(), CRYPTO_CONTEXT);
  } catch (error) {
    if (error instanceof SecretDecryptError)
      throw new GoogleAuthError(
        "Stored Google tokens can't be read (was AUTH_SECRET changed?). Connect Google Calendar again.",
        true,
      );
    throw error;
  }
}

export function getCalendarConnection(userId: string) {
  return db.googleCalendarConnection.findUnique({ where: { userId } });
}

/** Exchange the authorization code and store the (encrypted) tokens for this user. */
export async function completeGoogleConnection(code: string, userId: string) {
  const config = getGoogleConfig();
  if (!config.configured) throw new GoogleAuthError("Google Calendar is not set up on the server.");
  const req = buildTokenRequest(config, { code });
  const tokens = await parseTokenResponse(
    await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(30_000) }),
  );
  if (missingCalendarScope(tokens.scope))
    throw new GoogleAuthError(
      "Google didn't give access to your calendar. Try again and tick “See, edit, share and delete all events”.",
    );
  const existing = await getCalendarConnection(userId);
  const refreshToken = tokens.refreshToken ?? (existing ? decrypt(existing.refreshTokenEnc) : null);
  if (!refreshToken)
    throw new GoogleAuthError("Google didn't return a refresh token. Please try Connect again.");
  const data = {
    googleEmail: tokens.email ?? existing?.googleEmail ?? null,
    accessTokenEnc: encrypt(tokens.accessToken),
    refreshTokenEnc: encrypt(refreshToken),
    accessTokenExpiry: tokens.expiresAt,
    scopes: tokens.scope,
    needsReconnect: false,
    lastError: null,
  };
  // A different Google account than before: the old events live in the other account's
  // calendar, which we can no longer reach, so forget them (the resync creates new ones).
  const switchedAccount =
    !!existing?.googleEmail && !!tokens.email && existing.googleEmail !== tokens.email;
  await db.$transaction(async (tx) => {
    await tx.googleCalendarConnection.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    if (switchedAccount) await tx.googleCalendarEvent.deleteMany({ where: { userId } });
  });
  return { email: data.googleEmail, switchedAccount };
}

async function saveTokens(userId: string, tokens: GoogleTokenSet) {
  await db.googleCalendarConnection.update({
    where: { userId },
    data: {
      accessTokenEnc: encrypt(tokens.accessToken),
      ...(tokens.refreshToken ? { refreshTokenEnc: encrypt(tokens.refreshToken) } : {}),
      accessTokenExpiry: tokens.expiresAt,
      ...(tokens.scope ? { scopes: tokens.scope } : {}),
    },
  });
}

const refreshing = new Map<string, Promise<string>>();

/**
 * A valid access token for this user, refreshed when about to expire (or force=true after a
 * 401). A dead refresh token marks the connection as needing a reconnect. Concurrent callers
 * for the same user share one refresh.
 */
export async function getAccessToken(userId: string, force = false): Promise<string> {
  const conn = await getCalendarConnection(userId);
  if (!conn) throw new GoogleAuthError("Google Calendar is not connected.", true);
  if (conn.needsReconnect)
    throw new GoogleAuthError(conn.lastError ?? "Connect Google Calendar again.", true);
  if (!force && !tokenNeedsRefresh(conn.accessTokenExpiry)) return decrypt(conn.accessTokenEnc);
  const pending = refreshing.get(userId);
  if (pending) return pending;
  const run = (async () => {
    const config = getGoogleConfig();
    if (!config.configured)
      throw new GoogleAuthError("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.");
    try {
      const req = buildTokenRequest(config, { refreshToken: decrypt(conn.refreshTokenEnc) });
      let res: Response;
      try {
        res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        throw new GoogleAuthError(
          `Can't reach Google to refresh the connection: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const tokens = await parseTokenResponse(res);
      await saveTokens(userId, tokens);
      return tokens.accessToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reconnect = error instanceof GoogleAuthError && error.reconnect;
      await db.googleCalendarConnection
        .update({
          where: { userId },
          data: { lastError: message, ...(reconnect ? { needsReconnect: true } : {}) },
        })
        .catch(() => undefined);
      throw error;
    }
  })().finally(() => refreshing.delete(userId));
  refreshing.set(userId, run);
  return run;
}

/** An API client acting as this user, or null when Google isn't set up / they haven't connected. */
export async function getCalendarApi(userId: string) {
  const config = getGoogleConfig();
  if (!config.configured) return null;
  const conn = await getCalendarConnection(userId);
  if (!conn) return null;
  return {
    conn,
    api: new GoogleCalendarApi({
      apiUrl: config.apiUrl,
      getToken: (force) => getAccessToken(userId, force),
    }),
  };
}

/** Revoke Google's grant (best effort) and forget the tokens. */
export async function revokeAndDeleteConnection(
  userId: string,
): Promise<{ revoked: boolean; error?: string }> {
  const conn = await getCalendarConnection(userId);
  if (!conn) return { revoked: false };
  const config = getGoogleConfig();
  let revoked = false;
  let error: string | undefined;
  if (config.configured) {
    try {
      const req = buildRevokeRequest(config, decrypt(conn.refreshTokenEnc));
      const res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(15_000) });
      // 400 invalid_token: already revoked (e.g. removed in the Google account settings).
      revoked = res.ok || res.status === 400;
      if (!revoked) error = `Google returned HTTP ${res.status} when revoking`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  await db.$transaction([
    db.googleCalendarTask.updateMany({
      where: { userId, status: { in: ["PENDING", "FAILED"] } },
      data: {
        status: "CANCELLED",
        lastError: "Google Calendar was disconnected",
        completedAt: new Date(),
      },
    }),
    db.googleCalendarEvent.deleteMany({ where: { userId } }),
    db.googleCalendarConnection.delete({ where: { userId } }),
  ]);
  return { revoked, error };
}
