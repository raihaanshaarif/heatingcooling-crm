import "server-only";
import type { LeadSource, Priority, ServiceCategory } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit, logActivity, notifyRoles } from "@/server/audit";

export interface NewLeadData {
  name: string;
  email: string | null;
  phone: string | null;
  suburb: string | null;
  postcode: string | null;
  source: LeadSource;
  sourceDetail?: string | null;
  serviceCategory: ServiceCategory | null;
  brand: string | null;
  message: string | null;
  urgency: Priority;
  estimatedValueCents?: number | null;
  assignedToId?: string | null;
  followUpAt?: Date | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  gclid?: string | null;
  status?: "NEW" | "CONTACTED" | "SITE_VISIT_BOOKED" | "QUOTED" | "WON" | "LOST";
}

/** Create a lead with activity, audit and a notification for the office. Used by the UI and the website webhook. */
export async function createLeadRecord(tx: Tx, data: NewLeadData, userId: string | null) {
  // Link to an existing client automatically when the email or phone matches.
  const existingClient =
    data.email || data.phone
      ? await tx.client.findFirst({
          where: {
            deletedAt: null,
            OR: [
              ...(data.email ? [{ email: data.email }] : []),
              ...(data.phone ? [{ phone: data.phone }] : []),
            ],
          },
          select: { id: true },
        })
      : null;
  const lead = await tx.lead.create({
    data: {
      ...data,
      status: data.status ?? "NEW",
      source: existingClient && data.source === "OTHER" ? "REPEAT_CUSTOMER" : data.source,
      clientId: existingClient?.id ?? null,
    },
  });
  await logActivity(tx, {
    entityType: "LEAD",
    entityId: lead.id,
    type: "SYSTEM",
    body: userId ? "Lead created" : `Lead received from ${data.sourceDetail ?? "website form"}`,
    userId,
  });
  await audit(tx, {
    userId,
    action: "CREATE",
    entityType: "LEAD",
    entityId: lead.id,
    changes: data,
  });
  await notifyRoles(tx, ["ADMIN", "OFFICE"], {
    title: `New lead: ${lead.name}`,
    body: [data.suburb, data.message?.slice(0, 120)].filter(Boolean).join(" · ") || undefined,
    link: `/leads/${lead.id}`,
  });
  return lead;
}

/** Was the same person already captured in the last 24 hours? (website form double-submits) */
export async function findRecentDuplicate(email: string | null, phone: string | null, since: Date) {
  if (!email && !phone) return null;
  return db.lead.findFirst({
    where: {
      deletedAt: null,
      createdAt: { gte: since },
      OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
    },
    orderBy: { createdAt: "desc" },
  });
}
