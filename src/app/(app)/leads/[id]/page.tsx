import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, MapPin, Phone } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { LEAD_SOURCE_LABELS, PRIORITY_LABELS, SERVICE_CATEGORY_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getLead, getStaffOptions } from "@/server/leads/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { DetailList } from "@/components/shared/detail-list";
import { LeadStatusBadge, PriorityBadge, QuoteStatusBadge } from "@/components/shared/status-badge";
import { NoteForm, Timeline } from "@/components/shared/timeline";
import {
  FollowUpControl,
  LeadHeaderActions,
  LeadStatusControl,
} from "@/components/leads/lead-detail-actions";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("view", "leads");
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();
  const [staff, clients] = await Promise.all([
    getStaffOptions(),
    db.client.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const canEdit = can(user, "update", "leads");
  return (
    <>
      <PageHeader
        back={{ href: "/leads", label: "Leads" }}
        title={lead.name}
        badge={
          <>
            <span className="text-muted-foreground text-sm">L-{lead.leadNumber}</span>
            <LeadStatusBadge status={lead.status} />
            <PriorityBadge priority={lead.urgency} />
          </>
        }
        description={`Received ${formatDateTime(lead.createdAt)} via ${LEAD_SOURCE_LABELS[lead.source]}`}
        actions={
          <LeadHeaderActions
            lead={lead}
            staff={staff}
            clients={clients.map((c) => ({ value: c.id, label: c.name }))}
            canEdit={canEdit}
            canDelete={can(user, "delete", "leads")}
          />
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Enquiry</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {lead.message && (
                <p className="bg-muted/50 rounded-md p-3 text-sm whitespace-pre-line">
                  {lead.message}
                </p>
              )}
              <DetailList
                items={[
                  {
                    label: "Phone",
                    value: lead.phone && (
                      <a
                        href={`tel:${lead.phone.replace(/\s/g, "")}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Phone className="size-3.5" /> {lead.phone}
                      </a>
                    ),
                  },
                  {
                    label: "Email",
                    value: lead.email && (
                      <a
                        href={`mailto:${lead.email}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Mail className="size-3.5" /> {lead.email}
                      </a>
                    ),
                  },
                  {
                    label: "Location",
                    value: (lead.suburb || lead.postcode) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" />{" "}
                        {[lead.suburb, lead.postcode].filter(Boolean).join(" ")}
                      </span>
                    ),
                  },
                  {
                    label: "Service",
                    value: lead.serviceCategory
                      ? SERVICE_CATEGORY_LABELS[lead.serviceCategory]
                      : null,
                  },
                  { label: "Brand", value: lead.brand },
                  { label: "Urgency", value: PRIORITY_LABELS[lead.urgency] },
                  {
                    label: "Estimated value",
                    value: lead.estimatedValueCents ? formatCents(lead.estimatedValueCents) : null,
                  },
                  {
                    label: "Source",
                    value: `${LEAD_SOURCE_LABELS[lead.source]}${lead.sourceDetail ? ` · ${lead.sourceDetail}` : ""}`,
                  },
                  {
                    label: "Campaign",
                    value:
                      [lead.utmSource, lead.utmMedium, lead.utmCampaign]
                        .filter(Boolean)
                        .join(" / ") || null,
                  },
                  { label: "GCLID", value: lead.gclid },
                  { label: "Lost reason", value: lead.lostReason },
                  {
                    label: "Client",
                    value: lead.client && (
                      <Link href={`/clients/${lead.client.id}`} className="hover:underline">
                        {lead.client.name}
                      </Link>
                    ),
                  },
                  {
                    label: "Converted",
                    value: lead.convertedAt ? formatDate(lead.convertedAt) : null,
                  },
                ]}
              />
              {lead.quotes.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">Quotes</p>
                  {lead.quotes.map((q) => (
                    <Link
                      key={q.id}
                      href={`/quotes/${q.id}`}
                      className="hover:bg-muted flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span>
                        {q.number} · {q.title}
                      </span>
                      <span className="flex items-center gap-2">
                        {formatCents(q.totalCents)} <QuoteStatusBadge status={q.status} />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {canEdit && <NoteForm entityType="LEAD" entityId={lead.id} />}
              <Timeline items={lead.timeline} />
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Status</span>
              <LeadStatusControl id={lead.id} status={lead.status} disabled={!canEdit} />
            </div>
            <FollowUpControl id={lead.id} followUpAt={lead.followUpAt} disabled={!canEdit} />
            <DetailList
              items={[{ label: "Assigned to", value: lead.assignedTo?.name ?? "Unassigned" }]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
