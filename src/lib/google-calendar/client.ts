/**
 * Minimal Google Calendar API v3 client over fetch (events only). It adds the bearer token,
 * retries once with a fresh token on 401, turns rate limits (429, or 403 with a rate-limit
 * reason) into GoogleRateLimitError carrying Retry-After, and keeps the HTTP status on
 * errors so the sync can treat 404 / 410 (event gone) and 409 (id already used) specially.
 * https://developers.google.com/calendar/api/v3/reference/events
 */
import { parseRetryAfter } from "@/lib/outbox";
import type { GoogleEventBody } from "./events";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** False when retrying can't help (bad request, no permission). */
    readonly retryable: boolean,
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export class GoogleRateLimitError extends GoogleApiError {
  constructor(readonly retryAfterMs: number) {
    super(
      `Google Calendar rate limit reached; will retry in ${Math.ceil(retryAfterMs / 1000)}s`,
      429,
      true,
      "rateLimitExceeded",
    );
    this.name = "GoogleRateLimitError";
  }
}

const RATE_LIMIT_REASONS = ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"];

interface GoogleErrorBody {
  error?: { code?: number; message?: string; errors?: { reason?: string; message?: string }[] };
}

export function googleErrorReason(body: unknown): string | null {
  const b = body as GoogleErrorBody | null;
  return b?.error?.errors?.[0]?.reason ?? null;
}

export function googleErrorMessage(body: unknown, status: number): string {
  const b = body as GoogleErrorBody | null;
  const message = b?.error?.message ?? b?.error?.errors?.[0]?.message;
  if (message) return `Google Calendar: ${message}`;
  if (status === 401) return "Google rejected the access token";
  if (status === 403) return "Google refused access to the calendar";
  if (status === 404) return "Event or calendar not found in Google Calendar";
  if (status === 410) return "Event was deleted from Google Calendar";
  return `Google Calendar returned HTTP ${status}`;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  htmlLink?: string;
}

export interface GoogleCalendarApiOptions {
  apiUrl: string;
  /** Returns a valid access token; force=true refreshes it first (after a 401). */
  getToken: (force?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class GoogleCalendarApi {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  /** Requests made by this client (for logging / tests). */
  callCount = 0;

  constructor(private readonly options: GoogleCalendarApiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
  ): Promise<T | null> {
    const url = new URL(`${this.options.apiUrl}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const send = async (token: string) => {
      this.callCount += 1;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      try {
        return await this.fetchImpl(url.toString(), {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new GoogleApiError(`Can't reach Google Calendar: ${reason}`, 0, true);
      }
    };

    let res = await send(await this.options.getToken());
    if (res.status === 401) res = await send(await this.options.getToken(true));

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return json as T | null;
    const reason = googleErrorReason(json);
    if (res.status === 429 || (res.status === 403 && reason && RATE_LIMIT_REASONS.includes(reason)))
      throw new GoogleRateLimitError(parseRetryAfter(res.headers.get("retry-after"), this.now()));
    const retryable = res.status >= 500 || res.status === 401 || res.status === 408;
    throw new GoogleApiError(googleErrorMessage(json, res.status), res.status, retryable, reason);
  }

  private eventsPath(calendarId: string, eventId?: string) {
    const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
    return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
  }

  /** Insert with our own event id, so a retried create can't make a second event (409). */
  async insertEvent(calendarId: string, event: GoogleEventBody & { id?: string }) {
    const res = await this.request<GoogleEvent>("POST", this.eventsPath(calendarId), event, {
      sendUpdates: "none",
    });
    return res ?? { id: event.id ?? "" };
  }

  /** Full replace (PUT); also brings back an event that was deleted in Google (status cancelled). */
  async updateEvent(calendarId: string, eventId: string, event: GoogleEventBody) {
    const res = await this.request<GoogleEvent>(
      "PUT",
      this.eventsPath(calendarId, eventId),
      event,
      { sendUpdates: "none" },
    );
    return res ?? { id: eventId };
  }

  async deleteEvent(calendarId: string, eventId: string) {
    await this.request("DELETE", this.eventsPath(calendarId, eventId), undefined, {
      sendUpdates: "none",
    });
  }
}
