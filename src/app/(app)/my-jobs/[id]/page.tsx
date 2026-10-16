import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin, Navigation, Phone } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDateTime, formatMinutes } from "@/lib/dates";
import { EQUIPMENT_TYPE_LABELS } from "@/lib/labels";
import { formatAddress, formatPhoneAU, mapsUrl } from "@/lib/utils";
import { getJob } from "@/server/jobs/queries";
import { getPriceBookPicker } from "@/server/price-book/queries";
import { getSettings } from "@/server/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { JobStatusBadge, PriorityBadge } from "@/components/shared/status-badge";
import { FormDialogButton } from "@/components/shared/form-dialog-button";
import { Timeline } from "@/components/shared/timeline";
import { JobStatusActions } from "@/components/jobs/job-status-actions";
import { JobChecklist } from "@/components/jobs/job-checklist";
import { JobLineItems } from "@/components/jobs/job-line-items";
import { JobAttachments } from "@/components/jobs/job-attachments";
import { JobCompletionForm } from "@/components/jobs/job-completion-form";
import { JobNoteForm } from "@/components/jobs/job-note-form";
import { MyJobEquipmentLinker } from "@/components/jobs/my-job-equipment-linker";
import { SignaturePad } from "@/components/jobs/signature-pad";

export const metadata: Metadata = { title: "Job" };

export default async function MyJobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("view", "myJobs");
  const { id } = await params;
  const job = await getJob(id, user);
  if (!job) notFound();
  const [settings, priceBook] = await Promise.all([
    getSettings(),
    getPriceBookPicker({ includeCosts: false }),
  ]);
  const contact = job.client.contacts[0];
  const phone = contact?.phone ?? job.client.phone;
  const address = job.property ? formatAddress(job.property) : null;
  const isGas =
    job.serviceCategory === "GAS_HEATING" ||
    job.equipment.some((e) => ["DUCTED_GAS_HEATER", "WALL_FURNACE"].includes(e.equipment.type));
  const signature = job.attachments.find(
    (a) => a.kind === "SIGNATURE" && a.url === job.customerSignatureUrl,
  );
  const locked = job.status === "INVOICED";
  const notes = [
    { label: "Access", value: job.property?.accessNotes },
    { label: "Parking", value: job.property?.parkingNotes },
    { label: "Pets", value: job.property?.petNotes },
    { label: "Keys", value: job.property?.keyInfo },
  ].filter((n) => n.value);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        back={{ href: "/my-jobs", label: "My jobs" }}
        title={job.client.name}
        badge={
          <>
            <JobStatusBadge status={job.status} />
            <PriorityBadge priority={job.priority} />
          </>
        }
        description={`${job.number} · ${job.title}${job.scheduledStart ? ` · ${formatDateTime(job.scheduledStart)}` : ""}`}
      />
      <div className="space-y-4">
        {!locked && <JobStatusActions jobId={job.id} status={job.status} isTechnician large />}
        <div className="grid grid-cols-2 gap-2">
          {phone && (
            <Button asChild variant="outline" size="lg">
              <a href={`tel:${phone}`}>
                <Phone /> Call {contact?.name?.split(" ")[0] ?? ""}
              </a>
            </Button>
          )}
          {address && (
            <Button asChild variant="outline" size="lg">
              <a href={mapsUrl(address)} target="_blank" rel="noreferrer">
                <Navigation /> Directions
              </a>
            </Button>
          )}
        </div>
        <Card>
          <CardContent className="space-y-3 text-sm">
            {address && (
              <p className="flex items-start gap-2">
                <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" /> {address}
              </p>
            )}
            {phone && (
              <p className="flex items-center gap-2">
                <Phone className="text-muted-foreground size-4" />{" "}
                {contact?.name ? `${contact.name}: ` : ""}
                {formatPhoneAU(phone)}
              </p>
            )}
            {notes.map((n) => (
              <p key={n.label}>
                <span className="font-medium">{n.label}:</span> {n.value}
              </p>
            ))}
            {job.description && (
              <p className="border-t pt-3 whitespace-pre-line">{job.description}</p>
            )}
            {job.status === "ON_HOLD" && job.onHoldReason && (
              <p className="text-amber-600">On hold: {job.onHoldReason}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Equipment</CardTitle>
            {!locked && (
              <MyJobEquipmentLinker
                jobId={job.id}
                propertyId={job.propertyId}
                linkedEquipmentIds={job.equipment.map((e) => e.equipmentId)}
              />
            )}
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {job.equipment.length > 0 ? (
              job.equipment.map(({ equipment: e }) => (
                <div key={e.id} className="rounded-md border p-3">
                  <p className="font-medium">
                    {e.brand} {e.model}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {EQUIPMENT_TYPE_LABELS[e.type]}
                    {e.capacityKw ? ` · ${e.capacityKw} kW` : ""}
                    {e.refrigerant ? ` · ${e.refrigerant}` : ""}
                    {e.location ? ` · ${e.location}` : ""}
                    {e.serialNumber ? ` · S/N ${e.serialNumber}` : ""}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                No equipment linked yet. Use Link equipment to attach units serviced on site.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Checklist</CardTitle>
          </CardHeader>
          <CardContent>
            <JobChecklist jobId={job.id} items={job.checklistItems} readOnly={locked} large />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Photos</CardTitle>
          </CardHeader>
          <CardContent>
            <JobAttachments
              jobId={job.id}
              attachments={job.attachments}
              currentUserId={user.id}
              canDeleteAny={false}
              large
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Parts &amp; labour used</CardTitle>
          </CardHeader>
          <CardContent>
            <JobLineItems
              jobId={job.id}
              lines={job.lineItems}
              priceBook={priceBook}
              showPrices={can(user, "view", "prices")}
              showCosts={false}
              gstRegistered={settings.gstRegistered}
              readOnly={locked}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Completion</CardTitle>
            {!locked && (
              <FormDialogButton label="Edit" title="Completion details" size="sm">
                <JobCompletionForm job={job} showGas={isGas} />
              </FormDialogButton>
            )}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {job.completionNotes ? (
              <p className="whitespace-pre-line">{job.completionNotes}</p>
            ) : (
              <p className="text-muted-foreground">Add what you did before completing the job.</p>
            )}
            {(job.refrigerantRecoveredKg != null || job.refrigerantAddedKg != null) && (
              <p>
                Refrigerant: recovered {job.refrigerantRecoveredKg ?? 0} kg, added{" "}
                {job.refrigerantAddedKg ?? 0} kg
              </p>
            )}
            {job.gasComplianceCertNumber && (
              <p>Gas compliance cert: {job.gasComplianceCertNumber}</p>
            )}
            {isGas && !job.gasComplianceCertNumber && (
              <p className="text-amber-600">Gas job: record the compliance certificate number.</p>
            )}
            {signature ? (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element -- stored signature image */}
                <img
                  src={signature.url}
                  alt={`Signature of ${job.signedByName ?? "customer"}`}
                  className="h-24 rounded border bg-white p-2"
                />
                <p className="text-muted-foreground mt-1 text-xs">Signed by {job.signedByName}</p>
              </div>
            ) : (
              !locked && (
                <FormDialogButton
                  label="Customer signature"
                  title="Customer signature"
                  size="lg"
                  variant="default"
                >
                  <SignaturePad jobId={job.id} defaultName={contact?.name ?? job.client.name} />
                </FormDialogButton>
              )
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              Notes{" "}
              {job.timeEntries.length > 0 && (
                <span className="text-muted-foreground text-sm font-normal">
                  · {formatMinutes(job.timeEntries.reduce((s, t) => s + (t.minutes ?? 0), 0))}{" "}
                  logged
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <JobNoteForm jobId={job.id} />
            <Timeline items={job.timeline} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
