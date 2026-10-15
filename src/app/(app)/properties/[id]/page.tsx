import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Pencil, Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { EQUIPMENT_TYPE_LABELS, PLAN_FREQUENCY_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatAddress, mapsUrl } from "@/lib/utils";
import { getProperty } from "@/server/clients/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { DetailList } from "@/components/shared/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
import { ExpiryBadge } from "@/components/shared/status-badge";
import { JobsMiniTable } from "@/components/shared/record-tables";
import { FormDialogButton } from "@/components/shared/form-dialog-button";
import { PropertyForm } from "@/components/clients/property-form";
import { EquipmentForm } from "@/components/clients/equipment-form";
import { DeletePropertyButton } from "@/components/clients/delete-property-button";

export const metadata: Metadata = { title: "Property" };

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("view", "clients");
  const { id } = await params;
  const property = await getProperty(id);
  if (!property) notFound();
  const canEdit = can(user, "update", "clients");
  const address = formatAddress(property);
  return (
    <>
      <PageHeader
        back={{
          href: `/clients/${property.client.id}?tab=properties`,
          label: property.client.name,
        }}
        title={property.label ?? property.addressLine1}
        description={
          <a
            href={mapsUrl(address)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            {address} <ExternalLink className="size-3" />
          </a>
        }
        actions={
          canEdit && (
            <>
              <FormDialogButton label="Edit" title="Edit property" icon={<Pencil />} wide>
                <PropertyForm clientId={property.clientId} property={property} />
              </FormDialogButton>
              {can(user, "delete", "clients") && <DeletePropertyButton id={property.id} />}
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Site notes</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Access", value: property.accessNotes },
                { label: "Parking", value: property.parkingNotes },
                { label: "Pets", value: property.petNotes },
                { label: "Keys / lockbox", value: property.keyInfo },
                { label: "Client phone", value: property.client.phone },
              ]}
            />
            {!property.accessNotes &&
              !property.parkingNotes &&
              !property.petNotes &&
              !property.keyInfo && (
                <p className="text-muted-foreground text-sm">No site notes yet.</p>
              )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Equipment ({property.equipment.length})</CardTitle>
            {can(user, "create", "equipment") && (
              <FormDialogButton
                label="Add unit"
                title="Add equipment"
                icon={<Plus />}
                size="sm"
                wide
              >
                <EquipmentForm propertyId={property.id} />
              </FormDialogButton>
            )}
          </CardHeader>
          <CardContent>
            {property.equipment.length === 0 ? (
              <EmptyState
                title="No equipment"
                description="Record each indoor/outdoor unit, heater or cooler here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unit</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Last service</TableHead>
                    <TableHead>Warranty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {property.equipment.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">
                        <Link href={`/equipment/${e.id}`} className="hover:underline">
                          {e.brand} {e.model}
                        </Link>
                        {e.capacityKw ? (
                          <span className="text-muted-foreground"> · {e.capacityKw}kW</span>
                        ) : null}
                        {e.serialNumber && (
                          <p className="text-muted-foreground text-xs">S/N {e.serialNumber}</p>
                        )}
                      </TableCell>
                      <TableCell>{EQUIPMENT_TYPE_LABELS[e.type]}</TableCell>
                      <TableCell>{e.location ?? "–"}</TableCell>
                      <TableCell>
                        {e.lastServicedAt ? formatDate(e.lastServicedAt) : "Never"}
                      </TableCell>
                      <TableCell>
                        <ExpiryBadge date={e.warrantyExpiresAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {property.maintenancePlans.length > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Maintenance plans</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {property.maintenancePlans.map((p) => (
                <div key={p.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {p.name} · {PLAN_FREQUENCY_LABELS[p.frequency]} · {formatCents(p.priceCents)}
                    {!p.active && (
                      <Badge variant="muted" className="ml-2">
                        Inactive
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    Next due {formatDate(p.nextDueDate)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        <div className="space-y-2 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Jobs at this property</h2>
            {can(user, "create", "jobs") && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/jobs?new=1&clientId=${property.clientId}&propertyId=${property.id}`}>
                  <Plus /> New job
                </Link>
              </Button>
            )}
          </div>
          <JobsMiniTable jobs={property.jobs} />
        </div>
      </div>
    </>
  );
}
