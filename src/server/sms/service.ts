import "server-only";
import type { SmsKind, SmsStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { getSmsProvider } from "@/lib/sms";
import { formatAuMobile, pickMobile } from "@/lib/sms/phone";
import { countSegments, normaliseSmsText } from "@/lib/sms/segments";
import { firstName, greetingName, renderSms, resolveSmsSettings } from "@/lib/sms/templates";
import { formatPhoneAU } from "@/lib/utils";
import { logActivity } from "@/server/audit";
import { getSettings, type BusinessSettingsRecord } from "@/server/settings";

export const SMS_KIND_LABELS: Record<SmsKind, string> = {
  ON_MY_WAY: "On my way",
  APPOINTMENT_REMINDER: "Appointment reminder",
  SERVICE_DUE: "Service due",
  INVOICE_OVERDUE: "Overdue invoice",
  MANUAL: "One-off",
};

export const OPTED_OUT_REASON = "Client has opted out of SMS (No SMS)";

type ClientForSms = {
  id: string;
  type: string;
  name: string;
  phone: string | null;
  altPhone: string | null;
  noSms: boolean;
  contacts: { name: string; phone: string | null; isPrimary: boolean }[];
};

const clientSelect = {
  id: true,
  type: true,
  name: true,
  phone: true,
  altPhone: true,
  noSms: true,
  contacts: {
    select: { name: true, phone: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
  },
};

/** Numbers to try, in order: client mobile, alt phone, then the primary contact's. */
export function smsRecipient(client: ClientForSms) {
  const candidates = [client.phone, client.altPhone, ...client.contacts.map((c) => c.phone)];
  return pickMobile(candidates);
}

/** Placeholder values shared by every template for one client (and optionally a job). */
export function baseSmsVars(
  client: { type: string; name: string; contacts?: { name: string }[] },
  settings: Pick<BusinessSettingsRecord, "businessName" | "tradingName" | "phone">,
) {
  return {
    clientName: greetingName(client),
    businessName: settings.tradingName || settings.businessName,
    businessPhone: settings.phone ? formatPhoneAU(settings.phone) : "",
  };
}

export function jobSmsVars(job: {
  number: string;
  title: string;
  scheduledStart: Date | null;
  property: { addressLine1: string; suburb: string } | null;
  assignments: { user: { name: string } }[];
}) {
  return {
    jobNumber: job.number,
    jobTitle: job.title,
    date: job.scheduledStart ? formatDate(job.scheduledStart, "EEE d MMM") : "",
    time: job.scheduledStart ? formatDate(job.scheduledStart, "h:mmaaa") : "",
    address: job.property ? `${job.property.addressLine1}, ${job.property.suburb}` : "",
    suburb: job.property?.suburb ?? "",
    techName: firstName(job.assignments[0]?.user.name) || "our technician",
  };
}

export interface SendClientSmsInput {
  kind: SmsKind;
  clientId: string;
  body: string;
  jobId?: string | null;
  invoiceId?: string | null;
  maintenancePlanId?: string | null;
  sentById?: string | null;
}

export interface SendClientSmsResult {
  id: string;
  status: SmsStatus;
  to: string | null;
  /** Why it was skipped / failed. */
  reason?: string;
}

/**
 * Send one text to a client and record it: opt-out check, AU mobile normalisation,
 * smart-punctuation clean-up, provider call, SmsMessage row and a timeline entry on the
 * job / invoice / client. Never throws for provider errors (they're logged as FAILED).
 */
export async function sendClientSms(input: SendClientSmsInput): Promise<SendClientSmsResult> {
  const client = await db.client.findUnique({
    where: { id: input.clientId },
    select: clientSelect,
  });
  if (!client) throw new Error("Client not found");
  const body = normaliseSmsText(input.body);
  const segments = countSegments(body).segments;
  const recipient = smsRecipient(client);

  let status: SmsStatus;
  let error: string | undefined;
  let providerName = "none";
  let providerMessageId: string | undefined;
  if (client.noSms) {
    status = "SKIPPED";
    error = OPTED_OUT_REASON;
  } else if (!recipient.ok) {
    status = "SKIPPED";
    error = recipient.reason;
  } else {
    const provider = getSmsProvider();
    providerName = provider.name;
    const result = await provider.send({ to: recipient.e164, body });
    status = result.status;
    error = result.error;
    providerMessageId = result.id;
  }

  const to = recipient.ok ? recipient.e164 : null;
  const row = await db.smsMessage.create({
    data: {
      kind: input.kind,
      status,
      to,
      rawPhone: recipient.raw,
      body,
      segments,
      provider: providerName,
      providerMessageId,
      error,
      clientId: client.id,
      jobId: input.jobId ?? null,
      invoiceId: input.invoiceId ?? null,
      maintenancePlanId: input.maintenancePlanId ?? null,
      sentById: input.sentById ?? null,
    },
  });

  const label = SMS_KIND_LABELS[input.kind];
  const who = to ? formatAuMobile(to) : (recipient.raw ?? "no number");
  const summary =
    status === "SENT"
      ? `${label} text sent to ${who}`
      : status === "LOGGED"
        ? `${label} text logged for ${who} (SMS not set up, not sent)`
        : status === "SKIPPED"
          ? `${label} text not sent: ${error}`
          : `${label} text to ${who} failed: ${error}`;
  await logActivity(db, {
    entityType: input.jobId ? "JOB" : input.invoiceId ? "INVOICE" : "CLIENT",
    entityId: input.jobId ?? input.invoiceId ?? client.id,
    type: "SMS",
    body: `${summary}\n“${body}”`,
    userId: input.sentById ?? null,
  });

  return { id: row.id, status, to, reason: error };
}

/** "On my way" text when a technician taps On my way. Respects the toggle and opt-out. */
export async function sendOnMyWaySms(
  jobId: string,
  actor: { id: string; name: string; role: string },
) {
  const settings = await getSettings();
  const sms = resolveSmsSettings(settings.smsSettings);
  if (!sms.enabled.onMyWay) return null;
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      client: { select: clientSelect },
      property: { select: { addressLine1: true, suburb: true } },
      assignments: { include: { user: { select: { id: true, name: true } } } },
    },
  });
  if (!job) return null;
  // The person tapping On my way, unless the office did it for an assigned technician.
  const technician =
    actor.role === "TECHNICIAN" || job.assignments.some((a) => a.userId === actor.id)
      ? actor
      : (job.assignments[0]?.user ?? actor);
  const body = renderSms(sms.templates.onMyWay, {
    ...baseSmsVars(job.client, settings),
    ...jobSmsVars(job),
    techName: firstName(technician.name),
  });
  return sendClientSms({
    kind: "ON_MY_WAY",
    clientId: job.clientId,
    jobId: job.id,
    body,
    sentById: technician.id,
  });
}

/** Short message for the toast after On my way / Send SMS. */
export function describeSmsResult(result: SendClientSmsResult | null): string | undefined {
  if (!result) return undefined;
  if (result.status === "SENT") return `Text sent to ${formatAuMobile(result.to!)}`;
  if (result.status === "LOGGED") return "Text logged (SMS not set up)";
  if (result.status === "SKIPPED") return `No text sent: ${result.reason}`;
  return `Text failed: ${result.reason}`;
}
