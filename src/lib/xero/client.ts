/**
 * Minimal Xero Accounting API client over fetch. It adds the auth and tenant headers,
 * retries once with a fresh token on 401, turns 429 into a XeroRateLimitError that
 * carries Retry-After, and turns Xero's validation errors into readable messages.
 */

export class XeroApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** False when retrying can't help (validation errors): the job fails until someone fixes it. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "XeroApiError";
  }
}

export class XeroRateLimitError extends XeroApiError {
  constructor(
    readonly retryAfterMs: number,
    readonly problem: string | null,
  ) {
    super(
      `Xero rate limit reached${problem ? ` (${problem} limit)` : ""}; will retry in ${Math.ceil(retryAfterMs / 1000)}s`,
      429,
      true,
    );
    this.name = "XeroRateLimitError";
  }
}

export interface XeroApiOptions {
  apiUrl: string;
  tenantId: string;
  /** Returns a valid access token; force=true refreshes it first (after a 401). */
  getToken: (force?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  /** Calls per rolling minute before the client pauses (Xero allows 60 per tenant). */
  perMinute?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface XeroRequestOptions {
  idempotencyKey?: string;
  query?: Record<string, string | undefined>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retry-After is seconds (or an HTTP date). Missing → 60s. */
export function parseRetryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, seconds) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1000, date - now) : 60_000;
}

/** Pull the human messages out of a Xero error body (ValidationException etc.). */
export function xeroErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as {
      Message?: string;
      Detail?: string;
      Title?: string;
      Elements?: { ValidationErrors?: { Message?: string }[] }[];
    };
    const validation = (b.Elements ?? [])
      .flatMap((e) => e.ValidationErrors ?? [])
      .map((v) => v.Message)
      .filter((m): m is string => !!m);
    if (validation.length) return [...new Set(validation)].join("; ");
    if (b.Detail) return b.Detail;
    if (b.Message) return b.Message;
    if (b.Title) return b.Title;
  }
  if (status === 401) return "Xero rejected the access token";
  if (status === 403) return "Xero refused access (check the app's scopes and the organisation)";
  if (status === 404) return "Not found in Xero";
  return `Xero returned HTTP ${status}`;
}

export class XeroApi {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly calls: number[] = [];
  /** Requests made by this client (for logging / tests). */
  callCount = 0;

  constructor(private readonly options: XeroApiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  /** Simple client-side throttle so one sync run stays under the per-minute limit. */
  private async throttle() {
    const limit = this.options.perMinute ?? 55;
    const now = this.now();
    while (this.calls.length && now - this.calls[0]! > 60_000) this.calls.shift();
    if (this.calls.length >= limit) {
      await this.sleep(60_000 - (now - this.calls[0]!) + 50);
      this.calls.shift();
    }
    this.calls.push(this.now());
  }

  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    opts: XeroRequestOptions = {},
  ): Promise<T> {
    const url = new URL(
      path.startsWith("/connections") ? path : `/api.xro/2.0${path}`,
      `${this.options.apiUrl}/`,
    );
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v) url.searchParams.set(k, v);

    const send = async (token: string) => {
      await this.throttle();
      this.callCount += 1;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "xero-tenant-id": this.options.tenantId,
        Accept: "application/json",
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
      try {
        return await this.fetchImpl(url.toString(), {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new XeroApiError(`Can't reach Xero: ${reason}`, 0, true);
      }
    };

    let res = await send(await this.options.getToken());
    if (res.status === 401) res = await send(await this.options.getToken(true));

    if (res.status === 429) {
      throw new XeroRateLimitError(
        parseRetryAfter(res.headers.get("retry-after"), this.now()),
        res.headers.get("x-rate-limit-problem"),
      );
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 401 || res.status === 0;
      throw new XeroApiError(xeroErrorMessage(json, res.status), res.status, retryable);
    }
    return json as T;
  }

  get<T = unknown>(path: string, query?: Record<string, string | undefined>) {
    return this.request<T>("GET", path, undefined, { query });
  }
  post<T = unknown>(path: string, body: unknown, opts?: XeroRequestOptions) {
    return this.request<T>("POST", path, body, opts);
  }
  put<T = unknown>(path: string, body: unknown, opts?: XeroRequestOptions) {
    return this.request<T>("PUT", path, body, opts);
  }
}
