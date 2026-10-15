import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { EQUIPMENT_TYPE_LABELS, JOB_TYPE_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import { formatAddress } from "@/lib/utils";
import { getEquipment } from "@/server/equipment/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { DetailList } from "@/components/shared/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
import { ExpiryBadge, JobStatusBadge } from "@/components/shared/status-badge";
import { FormDialogButton } from "@/components/shared/form-dialog-button";
import { EquipmentForm } from "@/components/clients/equipment-form";
import { DeleteEquipmentButton } from "@/components/clients/delete-equipment-button";

export const metadata: Metadata = { title: "Equipment" };

export default async function EquipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("view", "clients");
  const { id } = await params;
  const e = await getEquipment(id);
  if (!e) notFound();
  return (
    <>
      <PageHeader
        back={{ href: `/properties/${e.propertyId}`, label: formatAddress(e.property) }}
        title={`${e.brand} ${e.model ?? ""}`}
        badge={<ExpiryBadge date={e.warrantyExpiresAt} />}
        description={
          <>
            {EQUIPMENT_TYPE_LABELS[e.type]} ·{" "}
            <Link className="hover:underline" href={`/clients/${e.property.client.id}`}>
              {e.property.client.name}
            </Link>
          </>
        }
        actions={
          can(user, "update", "equipment") && (
            <>
              <FormDialogButton label="Edit" title="Edit equipment" icon={<Pencil />} wide>
                <EquipmentForm equipment={e} />
              </FormDialogButton>
              {can(user, "delete", "equipment") && <DeleteEquipmentButton id={e.id} />}
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Serial", value: e.serialNumber },
                { label: "Indoor model", value: e.indoorModel },
                { label: "Outdoor model", value: e.outdoorModel },
                { label: "Capacity", value: e.capacityKw ? `${e.capacityKw} kW` : null },
                { label: "Refrigerant", value: e.refrigerant },
                { label: "Location", value: e.location },
                { label: "Installed", value: e.installDate ? formatDate(e.installDate) : null },
                { label: "Installed by us", value: e.installedByUs ? "Yes" : "No" },
                {
                  label: "Warranty until",
                  value: e.warrantyExpiresAt ? formatDate(e.warrantyExpiresAt) : null,
                },
                { label: "Maintenance plan", value: e.plans.map((p) => p.plan.name).join(", ") },
                { label: "Notes", value: e.notes },
              ]}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Service history</CardTitle>
          </CardHeader>
          <CardContent>
            {e.history.length === 0 ? (
              <EmptyState
                title="No service history"
                description="Jobs that list this unit will appear here."
              />
            ) : (
              <ol className="relative space-y-5 border-l pl-5">
                {e.history.map((h) => (
                  <li key={h.id} className="relative">
                    <span className="bg-primary absolute top-1.5 -left-[25px] size-2.5 rounded-full" />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Link href={`/jobs/${h.id}`} className="font-medium hover:underline">
                        {h.number}
                      </Link>
                      <span>{h.title}</span>
                      <JobStatusBadge status={h.status} />
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {formatDate(h.date)} · {JOB_TYPE_LABELS[h.type]}
                      {h.technicians.length > 0 && ` · ${h.technicians.join(", ")}`}
                      {h.refrigerantAddedKg ? ` · ${h.refrigerantAddedKg}kg refrigerant added` : ""}
                    </p>
                    {h.completionNotes && (
                      <p className="mt-1 text-sm whitespace-pre-line">{h.completionNotes}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
