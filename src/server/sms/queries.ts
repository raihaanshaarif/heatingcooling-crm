import "server-only";
import type { SmsStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { getSmsConfig } from "@/lib/sms";
import { formatAuMobile } from "@/lib/sms/phone";
import { renderSms, resolveSmsSettings, SMS_TEMPLATE_LABELS } from "@/lib/sms/templates";
import { SMS_TEMPLATE_KEYS, type SmsTemplateKey } from "@/lib/validations/settings";
import { getSettings } from "@/server/settings";
import { OPTED_OUT_REASON, baseSmsVars, jobSmsVars, smsRecipient } from "./service";

/** One-off texts make sense with these templates; the automatic ones are offered too. */
const COMPOSE_ORDER: SmsTemplateKey[] = [
  "general",
  "runningLate",
  "onMyWay",
  "appointmentReminder",
  "serviceDue",
];

export interface SmsComposeContext {
  clientId: string;
  jobId: string | null;
  clientName: string;
  /** Display form of the number the text will go to, or null. */
  to: string | null;
  /** Why the client can't be texted (opted out, landline…), or null when they can. */
  blockedReason: string | null;
  providerReady: boolean;
  templates: { key: SmsTemplateKey; label: string; body: string }[];
}

/** Data for the Send SMS dialog: who it goes to and every template filled in for this client / job. */
export async function getSmsComposeContext(
  clientId: string,
  jobId?: string | null,
): Promise<SmsComposeContext | null> {
  const [settings, client, job] = await Promise.all([
    getSettings(),
    db.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: {
        id: true,
        type: true,
        name: true,
        phone: true,
        altPhone: true,
        noSms: true,
        contacts: {
          select: { name: true, phone: true, isPrimary: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
        maintenancePlans: {
          where: { active: true },
          orderBy: { nextDueDate: "asc" },
          take: 1,
          select: { name: true, nextDueDate: true },
        },
      },
    }),
    jobId
      ? db.job.findUnique({
          where: { id: jobId },
          include: {
            property: { select: { addressLine1: true, suburb: true } },
            assignments: { include: { user: { select: { name: true } } } },
          },
        })
      : null,
  ]);
  if (!client) return null;
  const sms = resolveSmsSettings(settings.smsSettings);
  const recipient = smsRecipient(client);
  const plan = client.maintenancePlans[0];
  const vars = {
    ...baseSmsVars(client, settings),
    ...(job ? jobSmsVars(job) : {}),
    ...(plan
      ? {
          planName: plan.name,
          dueDate: formatDate(plan.nextDueDate),
        }
      : {}),
  };
  const keys = COMPOSE_ORDER.filter((k) => SMS_TEMPLATE_KEYS.includes(k)).filter(
    (k) => (k !== "onMyWay" && k !== "appointmentReminder") || job,
  );
  return {
    clientId: client.id,
    jobId: job?.id ?? null,
    clientName: client.name,
    to: recipient.ok ? formatAuMobile(recipient.e164) : null,
    blockedReason: client.noSms ? OPTED_OUT_REASON : recipient.ok ? null : recipient.reason,
    providerReady: getSmsConfig().provider !== "console",
    templates: keys
      .filter((k) => k !== "serviceDue" || plan)
      .map((key) => ({
        key,
        label: SMS_TEMPLATE_LABELS[key],
        body: renderSms(sms.templates[key], vars),
      })),
  };
}

export async function listSmsLog(filter: { status?: SmsStatus; take?: number } = {}) {
  const rows = await db.smsMessage.findMany({
    where: filter.status ? { status: filter.status } : {},
    orderBy: { createdAt: "desc" },
    take: filter.take ?? 200,
    include: {
      client: { select: { id: true, name: true } },
      job: { select: { id: true, number: true } },
      invoice: { select: { id: true, number: true } },
      sentBy: { select: { name: true } },
    },
  });
  return rows;
}
export type SmsLogRow = Awaited<ReturnType<typeof listSmsLog>>[number];

export async function smsStats(since: Date) {
  const grouped = await db.smsMessage.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { segments: true },
  });
  return Object.fromEntries(
    grouped.map((g) => [g.status, { count: g._count._all, segments: g._sum.segments ?? 0 }]),
  ) as Partial<Record<SmsStatus, { count: number; segments: number }>>;
}
