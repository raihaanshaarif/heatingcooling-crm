import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Phone } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime, formatMinutes } from "@/lib/dates";
import { EQUIPMENT_TYPE_LABELS, JOB_TYPE_LABELS, SERVICE_CATEGORY_LABELS } from "@/lib/labels";
import { formatAddress, formatPhoneAU, mapsUrl } from "@/lib/utils";
import { getClientOptions } from "@/server/clients/queries";
import { getJob, getTechnicianOptions } from "@/server/jobs/queries";
import { getPriceBookPicker } from "@/server/price-book/queries";
import { getSettings } from "@/server/settings";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { DetailList } from "@/components/shared/detail-list";
import {
  InvoiceStatusBadge,
  JobStatusBadge,
  PriorityBadge,
} from "@/components/shared/status-badge";
import { Timeline } from "@/components/shared/timeline";
import { FormDialogButton } from "@/components/shared/form-dialog-button";
import { JobStatusActions } from "@/components/jobs/job-status-actions";
import { JobHeaderActions } from "@/components/jobs/job-header-actions";
import { JobChecklist } from "@/components/jobs/job-checklist";
import { JobLineItems } from "@/components/jobs/job-line-items";
import { JobTimeEntries } from "@/components/jobs/job-time-entries";
import { JobAttachments } from "@/components/jobs/job-attachments";
import { JobCompletionForm } from "@/components/jobs/job-completion-form";
import { JobNoteForm } from "@/components/jobs/job-note-form";
import { SignaturePad } from "@/components/jobs/signature-pad";

export const metadata: Metadata = { title: "Job" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("view", "jobs");
  const { id } = await params;
  const job = await getJob(id, user);
  if (!job) notFound();
  const canEdit = can(user, "update", "schedule");
  const showCosts = can(user, "view", "priceBookCosts");
  const [settings, technicians, clients, priceBook] = await Promise.all([
    getSettings(),
    getTechnicianOptions(),
    canEdit ? getClientOptions() : [],
    getPriceBookPicker({ includeCosts: showCosts }),
  ]);
  const showPrices = can(user, "view", "prices");
  const isGas =
    job.serviceCategory === "GAS_HEATING" ||
    job.equipment.some((e) => ["DUCTED_GAS_HEATER", "WALL_FURNACE"].includes(e.equipment.type));
  const totalMinutes = job.timeEntries.reduce((s, t) => s + (t.minutes ?? 0), 0);
  const signature = job.attachments.find(
    (a) => a.kind === "SIGNATURE" && a.url === job.customerSignatureUrl,
  );
  const contact = job.client.contacts[0];
  const address = job.property ? formatAddress(job.property) : null;

  return (
    <>
      <PageHeader
        back={{
          href: user.role === "TECHNICIAN" ? "/my-jobs" : "/jobs",
          label: user.role === "TECHNICIAN" ? "My jobs" : "Jobs",
        }}
        title={job.number}
        badge={
          <>
            <JobStatusBadge status={job.status} />
            <PriorityBadge priority={job.priority} />
          </>
        }
        description={job.title}
        actions={
          <>
            <JobStatusActions
              jobId={job.id}
              status={job.status}
              isTechnician={user.role === "TECHNICIAN"}
            />
            <JobHeaderActions
              job={job}
              clients={clients}
              technicians={technicians}
              canEdit={canEdit}
              canInvoice={can(user, "create", "invoices")}
              canDelete={can(user, "delete", "jobs")}
            />
          </>
        }
      />
      {job.status === "ON_HOLD" && job.onHoldReason && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          On hold: {job.onHoldReason}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {job.description && (
            <Card>
              <CardContent className="text-sm whitespace-pre-line">{job.description}</CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Equipment</CardTitle>
            </CardHeader>
            <CardContent>
              {job.equipment.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No equipment linked. Edit the job to link units at this site.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {job.equipment.map(({ equipment: e }) => (
                    <li key={e.id} className="rounded-md border p-3 text-sm">
                      <Link href={`/equipment/${e.id}`} className="font-medium hover:underline">
                        {e.brand} {e.model}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {EQUIPMENT_TYPE_LABELS[e.type]}
                        {e.capacityKw ? ` · ${e.capacityKw} kW` : ""}
                        {e.refrigerant ? ` · ${e.refrigerant}` : ""}
                        {e.location ? ` · ${e.location}` : ""}
                      </p>
                      {e.serialNumber && (
                        <p className="text-muted-foreground text-xs">S/N {e.serialNumber}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <JobChecklist jobId={job.id} items={job.checklistItems} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Labour &amp; parts</CardTitle>
            </CardHeader>
            <CardContent>
              <JobLineItems
                jobId={job.id}
                lines={job.lineItems}
                priceBook={priceBook}
                showPrices={showPrices}
                showCosts={showCosts}
                gstRegistered={settings.gstRegistered}
                readOnly={job.status === "INVOICED"}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Photos &amp; documents</CardTitle>
            </CardHeader>
            <CardContent>
              <JobAttachments
                jobId={job.id}
                attachments={job.attachments}
                currentUserId={user.id}
                canDeleteAny={user.role !== "TECHNICIAN"}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Completion</CardTitle>
              <FormDialogButton label="Edit" title="Completion details" size="sm">
                <JobCompletionForm job={job} showGas={isGas} />
              </FormDialogButton>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailList
                items={[
                  { label: "Work performed", value: job.completionNotes },
                  {
                    label: "Refrigerant recovered",
                    value:
                      job.refrigerantRecoveredKg != null
                        ? `${job.refrigerantRecoveredKg} kg`
                        : null,
                  },
                  {
                    label: "Refrigerant added",
                    value: job.refrigerantAddedKg != null ? `${job.refrigerantAddedKg} kg` : null,
                  },
                  { label: "Gas compliance cert", value: job.gasComplianceCertNumber },
                  { label: "Signed by", value: job.signedByName },
                ]}
              />
              {!job.completionNotes && !job.signedByName && (
                <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
              )}
              {signature ? (
                // eslint-disable-next-line @next/next/no-img-element -- stored signature image
                <img
                  src={signature.url}
                  alt={`Signature of ${job.signedByName ?? "customer"}`}
                  className="h-24 rounded border bg-white p-2"
                />
              ) : (
                <FormDialogButton label="Capture signature" title="Customer signature" size="sm">
                  <SignaturePad jobId={job.id} defaultName={contact?.name ?? job.client.name} />
                </FormDialogButton>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <JobNoteForm jobId={job.id} />
              <Timeline items={job.timeline} />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  {
                    label: "Client",
                    value:
                      user.role === "TECHNICIAN" ? (
                        job.client.name
                      ) : (
                        <Link className="hover:underline" href={`/clients/${job.clientId}`}>
                          {job.client.name}
                        </Link>
                      ),
                  },
                  {
                    label: "Phone",
                    value: (contact?.phone ?? job.client.phone) && (
                      <a
                        href={`tel:${contact?.phone ?? job.client.phone}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Phone className="size-3" />{" "}
                        {formatPhoneAU(contact?.phone ?? job.client.phone)}
                      </a>
                    ),
                  },
                  {
                    label: "Site",
                    value: address && (
                      <a
                        href={mapsUrl(address)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-start gap-1 hover:underline"
                      >
                        <MapPin className="mt-0.5 size-3 shrink-0" /> {address}
                      </a>
                    ),
                  },
                  { label: "Access", value: job.property?.accessNotes },
                  { label: "Parking", value: job.property?.parkingNotes },
                  { label: "Pets", value: job.property?.petNotes },
                  { label: "Keys", value: job.property?.keyInfo },
                  { label: "Type", value: JOB_TYPE_LABELS[job.type] },
                  {
                    label: "Category",
                    value: job.serviceCategory
                      ? SERVICE_CATEGORY_LABELS[job.serviceCategory]
                      : null,
                  },
                  {
                    label: "Scheduled",
                    value: job.scheduledStart
                      ? `${formatDateTime(job.scheduledStart)}${job.scheduledEnd ? ` – ${formatDateTime(job.scheduledEnd).split(", ").pop()}` : ""}`
                      : "Unscheduled",
                  },
                  {
                    label: "Estimate",
                    value: job.estimatedMinutes ? formatMinutes(job.estimatedMinutes) : null,
                  },
                  {
                    label: "On the way",
                    value: job.enRouteAt ? formatDateTime(job.enRouteAt) : null,
                  },
                  {
                    label: "Started",
                    value: job.actualStart ? formatDateTime(job.actualStart) : null,
                  },
                  {
                    label: "Finished",
                    value: job.actualEnd ? formatDateTime(job.actualEnd) : null,
                  },
                  {
                    label: "Quote",
                    value: job.quote && (
                      <Link className="hover:underline" href={`/quotes/${job.quote.id}`}>
                        {job.quote.number}
                      </Link>
                    ),
                    hidden: user.role === "TECHNICIAN",
                  },
                  { label: "Plan", value: job.maintenancePlan?.name },
                  { label: "Created", value: formatDate(job.createdAt) },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Technicians</CardTitle>
            </CardHeader>
            <CardContent>
              {job.assignments.length === 0 ? (
                <p className="text-muted-foreground text-sm">Unassigned</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {job.assignments.map((a) => (
                    <li key={a.userId} className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: a.user.color }}
                      />
                      {a.user.name}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                Time{" "}
                {totalMinutes > 0 && (
                  <span className="text-muted-foreground text-sm font-normal">
                    · {formatMinutes(totalMinutes)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <JobTimeEntries
                jobId={job.id}
                entries={job.timeEntries}
                people={technicians.map((t) => ({ value: t.value, label: t.label }))}
                currentUserId={user.id}
                canManageOthers={user.role !== "TECHNICIAN"}
              />
            </CardContent>
          </Card>
          {showPrices && job.invoices.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Invoices</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {job.invoices.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2">
                      <Link href={`/invoices/${i.id}`} className="font-medium hover:underline">
                        {i.number}
                      </Link>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{formatCents(i.totalCents)}</span>
                        <InvoiceStatusBadge status={i.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {isGas &&
            !job.gasComplianceCertNumber &&
            ["IN_PROGRESS", "COMPLETED"].includes(job.status) && (
              <Badge variant="warning" className="w-full justify-center py-1.5">
                Gas job: record the compliance certificate number
              </Badge>
            )}
        </div>
      </div>
    </>
  );
}
