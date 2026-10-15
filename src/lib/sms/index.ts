import "server-only";
import { createSmsProvider, readSmsConfig, type SmsConfig, type SmsProvider } from "./providers";

/**
 * SMS entry point for server code. Pick a provider with SMS_PROVIDER=twilio|messagemedia
 * and its credentials (see .env.example). Without them every text is printed to the
 * server log instead of sent (status LOGGED), so all flows work locally.
 *
 * Callers normally go through src/server/sms/service.ts, which also checks opt-outs,
 * normalises the number and writes the SMS log.
 */
export function getSmsConfig(): SmsConfig {
  return readSmsConfig(process.env);
}

export function getSmsProvider(): SmsProvider {
  return createSmsProvider(getSmsConfig());
}

export const SMS_PROVIDER_LABELS: Record<SmsProvider["name"], string> = {
  twilio: "Twilio",
  messagemedia: "MessageMedia",
  console: "Not set up (texts are logged only)",
};

export type { SmsConfig, SmsMessage, SmsProvider, SmsSendResult } from "./providers";
export { normaliseAuMobile, pickMobile, formatAuMobile } from "./phone";
export { countSegments, normaliseSmsText } from "./segments";
