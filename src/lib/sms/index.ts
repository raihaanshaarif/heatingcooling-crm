import "server-only";

/**
 * Phase 2: SMS reminders ("Your technician is on the way", appointment and
 * service-due reminders). Pick a provider with SMS_PROVIDER=twilio|messagemedia.
 * Until then sendSms() logs to the console so callers can be wired in safely.
 */
export interface SmsMessage {
  to: string; // E.164, e.g. +61412345678
  body: string;
}

export interface SmsResult {
  ok: boolean;
  id?: string;
  skipped?: boolean;
  error?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsResult>;
}

class ConsoleProvider implements SmsProvider {
  readonly name = "console";
  async send(message: SmsMessage): Promise<SmsResult> {
    console.info(`[sms:dev] To: ${message.to} | ${message.body}`);
    return { ok: true, skipped: true };
  }
}

// TODO(Phase 2): POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json with basic auth
// (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) and From=SMS_FROM.
class TwilioProvider implements SmsProvider {
  readonly name = "twilio";
  async send(): Promise<SmsResult> {
    return { ok: false, error: "Twilio SMS is planned for Phase 2." };
  }
}

// TODO(Phase 2): POST https://api.messagemedia.com/v1/messages with MESSAGEMEDIA_API_KEY / MESSAGEMEDIA_API_SECRET.
// MessageMedia is Australian-owned and popular with AU trades.
class MessageMediaProvider implements SmsProvider {
  readonly name = "messagemedia";
  async send(): Promise<SmsResult> {
    return { ok: false, error: "MessageMedia SMS is planned for Phase 2." };
  }
}

export function getSmsProvider(): SmsProvider {
  switch (process.env.SMS_PROVIDER) {
    case "twilio":
      return new TwilioProvider();
    case "messagemedia":
      return new MessageMediaProvider();
    default:
      return new ConsoleProvider();
  }
}

/** Convert an Australian mobile (0412 345 678) to E.164 (+61412345678). */
export function toE164AU(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  if (/^614\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}

export async function sendSms(message: SmsMessage): Promise<SmsResult> {
  return getSmsProvider().send(message);
}
