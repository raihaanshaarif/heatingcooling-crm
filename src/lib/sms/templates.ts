import {
  SMS_AUTO_KEYS,
  SMS_TEMPLATE_KEYS,
  type SmsAutoKey,
  type SmsSettings,
  type SmsTemplateKey,
} from "@/lib/validations/settings";
import { renderTemplate } from "@/lib/template";
import { normaliseSmsText } from "./segments";

/** Defaults for Settings → SMS. Same {{placeholder}} style as the email templates. */
export const DEFAULT_SMS_TEMPLATES: Record<SmsTemplateKey, string> = {
  onMyWay:
    "Hi {{clientName}}, it's {{techName}} from {{businessName}}. I'm on my way to you now. Any questions call {{businessPhone}}.",
  appointmentReminder:
    "Hi {{clientName}}, a reminder that {{businessName}} is booked to visit {{suburb}} tomorrow, {{date}} at {{time}}. Need to change it? Call {{businessPhone}}.",
  serviceDue:
    "Hi {{clientName}}, your {{planName}} with {{businessName}} is due on {{dueDate}}. Call {{businessPhone}} to book a time that suits.",
  invoiceOverdue:
    "Hi {{clientName}}, invoice {{invoiceNumber}} from {{businessName}} ({{balance}}) was due on {{dueDate}}. View it here: {{link}} If you've already paid, thank you!",
  runningLate:
    "Hi {{clientName}}, it's {{businessName}}. Our technician is running a little behind today. Sorry for the wait, we'll be with you as soon as we can.",
  general: "Hi {{clientName}}, it's {{businessName}}. ",
};

export const DEFAULT_SMS_ENABLED: Record<SmsAutoKey, boolean> = {
  onMyWay: true,
  appointmentReminder: true,
  serviceDue: true,
  invoiceOverdue: false,
};

export const SMS_TEMPLATE_LABELS: Record<SmsTemplateKey, string> = {
  onMyWay: "On my way",
  appointmentReminder: "Appointment reminder (day before)",
  serviceDue: "Service due reminder",
  invoiceOverdue: "Overdue invoice",
  runningLate: "Running late",
  general: "General message",
};

export const SMS_TEMPLATE_DESCRIPTIONS: Record<SmsTemplateKey, string> = {
  onMyWay: "Sent to the client when a technician taps On my way.",
  appointmentReminder:
    "Sent by the daily reminder run (8am) for every scheduled job tomorrow. Once per job and date.",
  serviceDue:
    "Sent with the service-due email when a maintenance plan is due within 14 days. Once per due date.",
  invoiceOverdue:
    "Sent with the overdue email at 1, 7 and 14 days overdue. Off by default: some clients find it pushy.",
  runningLate: "One-off template for the Send SMS dialog.",
  general: "One-off template for the Send SMS dialog.",
};

const COMMON = ["clientName", "businessName", "businessPhone"];
export const SMS_TEMPLATE_VARIABLES: Record<SmsTemplateKey, string[]> = {
  onMyWay: [...COMMON, "techName", "jobNumber", "address", "suburb"],
  appointmentReminder: [
    ...COMMON,
    "date",
    "time",
    "techName",
    "jobNumber",
    "jobTitle",
    "address",
    "suburb",
  ],
  serviceDue: [...COMMON, "planName", "dueDate"],
  invoiceOverdue: [...COMMON, "invoiceNumber", "balance", "dueDate", "daysOverdue", "link"],
  runningLate: [...COMMON, "techName", "jobNumber", "address", "suburb", "date", "time"],
  general: [...COMMON, "techName", "jobNumber", "address", "suburb", "date", "time"],
};

/** Example values for the live preview / character count in Settings. */
export const SMS_SAMPLE_VARS: Record<string, string> = {
  clientName: "Sarah",
  businessName: "Cooling Service Melbourne",
  businessPhone: "03 9000 1234",
  techName: "Jack",
  jobNumber: "J-0123",
  jobTitle: "Split system service",
  address: "12 Smith St, Brunswick VIC 3056",
  suburb: "Brunswick",
  date: "Thu 16 Oct",
  time: "9:30am",
  planName: "Annual split system service",
  dueDate: "28 Oct 2026",
  invoiceNumber: "INV-0456",
  balance: "$385.00",
  daysOverdue: "7",
  link: "https://app.coolingservicemelbourne.com.au/i/ckx9a8b7c6d5e4f3",
};

export function resolveSmsSettings(stored: unknown): SmsSettings {
  const result: SmsSettings = {
    enabled: { ...DEFAULT_SMS_ENABLED },
    templates: { ...DEFAULT_SMS_TEMPLATES },
  };
  if (!stored || typeof stored !== "object") return result;
  const { enabled, templates } = stored as { enabled?: unknown; templates?: unknown };
  if (enabled && typeof enabled === "object") {
    for (const key of SMS_AUTO_KEYS) {
      const v = (enabled as Record<string, unknown>)[key];
      if (typeof v === "boolean") result.enabled[key] = v;
    }
  }
  if (templates && typeof templates === "object") {
    for (const key of SMS_TEMPLATE_KEYS) {
      const v = (templates as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) result.templates[key] = v;
    }
  }
  return result;
}

/** Render a template and tidy it for sending (plain punctuation, no stray spaces). */
export function renderSms(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return normaliseSmsText(renderTemplate(template, vars).replace(/ {2,}/g, " "));
}

/** First name for a friendly greeting ("Sarah Nguyen" → "Sarah"). */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * Who to greet: residential clients by their first name; businesses by their primary
 * contact's first name, falling back to "there" rather than "Hi Melbourne,".
 */
export function greetingName(client: {
  type: string;
  name: string;
  contacts?: { name: string }[];
}): string {
  if (client.type === "RESIDENTIAL") return firstName(client.name) || "there";
  const contact = client.contacts?.[0]?.name;
  return contact ? firstName(contact) : "there";
}
