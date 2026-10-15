/**
 * SMS providers: Twilio and MessageMedia over plain fetch, plus a console provider used
 * when no credentials are set (local dev, or before the business signs up). Request
 * building and response parsing are pure functions so they can be unit-tested without
 * reaching the real APIs.
 */

export interface SmsMessage {
  to: string; // E.164, e.g. +61412345678
  body: string;
}

export interface SmsSendResult {
  /** SENT: accepted by the provider. LOGGED: printed by the console provider. FAILED: refused / network error. */
  status: "SENT" | "LOGGED" | "FAILED";
  id?: string;
  error?: string;
}

export interface SmsProvider {
  readonly name: "twilio" | "messagemedia" | "console";
  send(message: SmsMessage): Promise<SmsSendResult>;
}

export interface TwilioConfig {
  provider: "twilio";
  accountSid: string;
  authToken: string;
  /** A Twilio phone number / alphanumeric sender ID, or a Messaging Service SID (MG…). */
  from?: string;
  messagingServiceSid?: string;
}

export interface MessageMediaConfig {
  provider: "messagemedia";
  apiKey: string;
  apiSecret: string;
  /** Optional dedicated number (+61…) or alphanumeric sender ID; empty uses MessageMedia's shared pool. */
  from?: string;
}

export interface ConsoleConfig {
  provider: "console";
  /** Which provider was asked for but is missing settings, so the UI can say what to fix. */
  requested?: "twilio" | "messagemedia";
  missing: string[];
}

export type SmsConfig = TwilioConfig | MessageMediaConfig | ConsoleConfig;

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined) => v?.trim() || undefined;

/** Read SMS_PROVIDER and the provider's credentials. Anything missing → console provider. */
export function readSmsConfig(env: Env = process.env): SmsConfig {
  const requested = clean(env.SMS_PROVIDER)?.toLowerCase();
  if (requested === "twilio") {
    const accountSid = clean(env.TWILIO_ACCOUNT_SID);
    const authToken = clean(env.TWILIO_AUTH_TOKEN);
    const from = clean(env.SMS_FROM);
    const messagingServiceSid =
      clean(env.TWILIO_MESSAGING_SERVICE_SID) ?? (from?.startsWith("MG") ? from : undefined);
    const missing = [
      !accountSid && "TWILIO_ACCOUNT_SID",
      !authToken && "TWILIO_AUTH_TOKEN",
      !from && !messagingServiceSid && "SMS_FROM (or TWILIO_MESSAGING_SERVICE_SID)",
    ].filter(Boolean) as string[];
    if (missing.length) return { provider: "console", requested: "twilio", missing };
    return {
      provider: "twilio",
      accountSid: accountSid!,
      authToken: authToken!,
      from: messagingServiceSid ? undefined : from,
      messagingServiceSid,
    };
  }
  if (requested === "messagemedia") {
    const apiKey = clean(env.MESSAGEMEDIA_API_KEY);
    const apiSecret = clean(env.MESSAGEMEDIA_API_SECRET);
    const missing = [
      !apiKey && "MESSAGEMEDIA_API_KEY",
      !apiSecret && "MESSAGEMEDIA_API_SECRET",
    ].filter(Boolean) as string[];
    if (missing.length) return { provider: "console", requested: "messagemedia", missing };
    return {
      provider: "messagemedia",
      apiKey: apiKey!,
      apiSecret: apiSecret!,
      from: clean(env.SMS_FROM),
    };
  }
  return { provider: "console", missing: [] };
}

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

export interface HttpRequest {
  url: string;
  init: { method: "POST"; headers: Record<string, string>; body: string };
}

// ─── Twilio ──────────────────────────────────────────────────────────────────

/** POST /2010-04-01/Accounts/{sid}/Messages.json, form-encoded, HTTP basic auth (SID:token). */
export function buildTwilioRequest(config: TwilioConfig, message: SmsMessage): HttpRequest {
  const form = new URLSearchParams({ To: message.to, Body: message.body });
  if (config.messagingServiceSid) form.set("MessagingServiceSid", config.messagingServiceSid);
  else if (config.from) form.set("From", config.from);
  return {
    url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
    init: {
      method: "POST",
      headers: {
        Authorization: basicAuth(config.accountSid, config.authToken),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    },
  };
}

/** Twilio replies 201 with { sid, status } or 4xx with { code, message }. */
export function parseTwilioResponse(httpStatus: number, json: unknown): SmsSendResult {
  const data = (json ?? {}) as Record<string, unknown>;
  if (httpStatus >= 200 && httpStatus < 300 && typeof data.sid === "string") {
    if (data.status === "failed" || data.status === "undelivered") {
      return {
        status: "FAILED",
        id: data.sid,
        error: `Twilio: ${String(data.error_message ?? data.status)}`,
      };
    }
    return { status: "SENT", id: data.sid };
  }
  const code = data.code ? ` (${String(data.code)})` : "";
  return {
    status: "FAILED",
    error: `Twilio${code}: ${typeof data.message === "string" ? data.message : `HTTP ${httpStatus}`}`,
  };
}

// ─── MessageMedia ────────────────────────────────────────────────────────────

/** POST https://api.messagemedia.com/v1/messages, JSON, HTTP basic auth (API key:secret). */
export function buildMessageMediaRequest(
  config: MessageMediaConfig,
  message: SmsMessage,
): HttpRequest {
  const payload: Record<string, unknown> = {
    content: message.body,
    destination_number: message.to,
    format: "SMS",
  };
  if (config.from) {
    payload.source_number = config.from;
    payload.source_number_type = /^\+?\d+$/.test(config.from) ? "INTERNATIONAL" : "ALPHANUMERIC";
  }
  return {
    url: "https://api.messagemedia.com/v1/messages",
    init: {
      method: "POST",
      headers: {
        Authorization: basicAuth(config.apiKey, config.apiSecret),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ messages: [payload] }),
    },
  };
}

/** MessageMedia replies 202 with { messages: [{ message_id, status }] } or 4xx with { message, details }. */
export function parseMessageMediaResponse(httpStatus: number, json: unknown): SmsSendResult {
  const data = (json ?? {}) as Record<string, unknown>;
  const first = Array.isArray(data.messages)
    ? (data.messages[0] as Record<string, unknown> | undefined)
    : undefined;
  if (httpStatus >= 200 && httpStatus < 300 && typeof first?.message_id === "string") {
    return { status: "SENT", id: first.message_id };
  }
  const details = Array.isArray(data.details) ? ` ${data.details.map(String).join("; ")}` : "";
  const message = typeof data.message === "string" ? data.message : `HTTP ${httpStatus}`;
  return { status: "FAILED", error: `MessageMedia: ${message}${details}`.trim() };
}

// ─── Providers ───────────────────────────────────────────────────────────────

type Fetch = typeof fetch;

async function post(
  request: HttpRequest,
  parse: (status: number, json: unknown) => SmsSendResult,
  fetchImpl: Fetch,
  label: string,
): Promise<SmsSendResult> {
  try {
    const res = await fetchImpl(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(15_000),
    });
    const json: unknown = await res.json().catch(() => null);
    return parse(res.status, json);
  } catch (error) {
    return {
      status: "FAILED",
      error: `${label}: ${error instanceof Error ? error.message : "network error"}`,
    };
  }
}

export function createSmsProvider(config: SmsConfig, fetchImpl: Fetch = fetch): SmsProvider {
  switch (config.provider) {
    case "twilio":
      return {
        name: "twilio",
        send: (m) => post(buildTwilioRequest(config, m), parseTwilioResponse, fetchImpl, "Twilio"),
      };
    case "messagemedia":
      return {
        name: "messagemedia",
        send: (m) =>
          post(
            buildMessageMediaRequest(config, m),
            parseMessageMediaResponse,
            fetchImpl,
            "MessageMedia",
          ),
      };
    default:
      return {
        name: "console",
        async send(m) {
          console.info(`[sms:dev] To: ${m.to} | ${m.body} (SMS provider not configured, not sent)`);
          return { status: "LOGGED" };
        },
      };
  }
}
