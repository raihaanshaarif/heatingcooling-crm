import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Building2,
  FileText,
  KeyRound,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Receipt,
  Wrench,
} from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import {
  CLIENT_TYPE_LABELS,
  EQUIPMENT_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
  PLAN_FREQUENCY_LABELS,
} from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatAddress } from "@/lib/utils";
import { getClient } from "@/server/clients/queries";
import { getSmsComposeContext } from "@/server/sms/queries";
import { SendSmsForm } from "@/components/sms/send-sms-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DetailList } from "@/components/shared/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
import { ExpiryBadge, LeadStatusBadge } from "@/components/shared/status-badge";
import {
  InvoicesMiniTable,
  JobsMiniTable,
  PaymentsMiniTable,
  QuotesMiniTable,
} from "@/components/shared/record-tables";
import { NoteForm, Timeline } from "@/components/shared/timeline";
import { FormDialogButton } from "@/components/shared/form-dialog-button";
import { ClientActions } from "@/components/clients/client-actions";
import { ContactsCard } from "@/components/clients/contacts-card";
import { PropertyForm } from "@/components/clients/property-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const client = await getClient(id);
  return { title: client?.name ?? "Client" };
}

const TABS = [
  "overview",
  "properties",
  "equipment",
  "quotes",
  "jobs",
  "invoices",
  "payments",
  "activity",
] as const;

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePermission("view", "clients");
  const { id } = await params;
  const { tab } = await searchParams;
  const client = await getClient(id);
  if (!client) notFound();
  const canEdit = can(user, "update", "clients");
  const smsContext = can(user, "create", "sms") ? await getSmsComposeContext(client.id) : null;
  const defaultTab = TABS.includes(tab as (typeof TABS)[number]) ? tab : "overview";
  const equipment = client.properties.flatMap((p) =>
    p.equipment.map((e) => ({ ...e, property: p })),
  );
  const billing = formatAddress({
    addressLine1: client.billingLine1,
    addressLine2: client.billingLine2,
    suburb: client.billingSuburb,
    state: client.billingState,
    postcode: client.billingPostcode,
  });

  return (
    <>
      <PageHeader
        back={{ href: "/clients", label: "Clients" }}
        title={client.name}
        badge={
          <>
            <Badge variant="outline">{CLIENT_TYPE_LABELS[client.type]}</Badge>
            {client.doNotService && <Badge variant="destructive">Do not service</Badge>}
            {client.noSms && <Badge variant="warning">No SMS</Badge>}
            {client.tags
              .filter((t) => t !== "Do not service")
              .map((t) => (
                <Badge
                  key={t}
                  variant={t === "VIP" ? "violet" : t === "Slow payer" ? "warning" : "secondary"}
                >
                  {t}
                </Badge>
              ))}
          </>
        }
        description={client.companyName}
        actions={
          <>
            {can(user, "create", "quotes") && (
              <Button asChild variant="outline">
                <Link href={`/quotes/new?clientId=${client.id}`}>
                  <FileText /> Quote
                </Link>
              </Button>
            )}
            {can(user, "create", "jobs") && (
              <Button asChild variant="outline">
                <Link href={`/jobs?new=1&clientId=${client.id}`}>
                  <Wrench /> Job
                </Link>
              </Button>
            )}
            {can(user, "create", "invoices") && (
              <Button asChild variant="outline">
                <Link href={`/invoices/new?clientId=${client.id}`}>
                  <Receipt /> Invoice
                </Link>
              </Button>
            )}
            {smsContext && (
              <FormDialogButton label="SMS" title={`Text ${client.name}`} icon={<MessageSquare />}>
                <SendSmsForm context={smsContext} />
              </FormDialogButton>
            )}
            <ClientActions
              client={client}
              canEdit={canEdit}
              canDelete={can(user, "delete", "clients")}
            />
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Lifetime value"
          value={formatCents(client.lifetimeValueCents)}
          hint="Total payments received"
        />
        <StatCard
          label="Outstanding"
          value={formatCents(client.outstandingCents)}
          tone={client.outstandingCents > 0 ? "danger" : "default"}
        />
        <StatCard
          label="Jobs"
          value={client.jobs.length}
          hint={`${client.properties.length} properties · ${equipment.length} units`}
        />
        <StatCard
          label="Last service"
          value={client.lastServiceAt ? formatDate(client.lastServiceAt) : "Never"}
        />
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="properties">Properties ({client.properties.length})</TabsTrigger>
          <TabsTrigger value="equipment">Equipment ({equipment.length})</TabsTrigger>
          <TabsTrigger value="quotes">Quotes ({client.quotes.length})</TabsTrigger>
          <TabsTrigger value="jobs">Jobs ({client.jobs.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({client.invoices.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-2 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  {
                    label: "Phone",
                    value: client.phone && (
                      <a
                        className="inline-flex items-center gap-1 hover:underline"
                        href={`tel:${client.phone.replace(/\s/g, "")}`}
                      >
                        <Phone className="size-3.5" /> {client.phone}
                      </a>
                    ),
                  },
                  { label: "Alt. phone", value: client.altPhone },
                  {
                    label: "Email",
                    value: client.email && (
                      <a
                        className="inline-flex items-center gap-1 hover:underline"
                        href={`mailto:${client.email}`}
                      >
                        <Mail className="size-3.5" /> {client.email}
                      </a>
                    ),
                  },
                  { label: "Billing address", value: billing },
                  { label: "ABN", value: client.abn },
                  {
                    label: "Source",
                    value: client.source ? LEAD_SOURCE_LABELS[client.source] : null,
                  },
                  { label: "Client since", value: formatDate(client.createdAt) },
                  { label: "Notes", value: client.notes },
                ]}
              />
            </CardContent>
          </Card>
          <ContactsCard clientId={client.id} contacts={client.contacts} canEdit={canEdit} />
          {client.leads.length > 0 && (
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Leads</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {client.leads.map((l) => (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="hover:bg-muted flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
                  >
                    L-{l.leadNumber} · {formatDate(l.createdAt)}{" "}
                    <LeadStatusBadge status={l.status} />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          {client.maintenancePlans.length > 0 && (
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Maintenance plans</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {client.maintenancePlans.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
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
        </TabsContent>

        <TabsContent value="properties" className="mt-2 space-y-4">
          {canEdit && (
            <div className="flex justify-end">
              <FormDialogButton label="Add property" title="Add property" icon={<Plus />} wide>
                <PropertyForm clientId={client.id} />
              </FormDialogButton>
            </div>
          )}
          {client.properties.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="No properties"
              description="Add the address where work is done."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {client.properties.map((p) => (
                <Card key={p.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="text-muted-foreground size-4" />
                      <Link href={`/properties/${p.id}`} className="hover:underline">
                        {p.label ?? p.addressLine1}
                      </Link>
                    </CardTitle>
                    <CardAction>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/properties/${p.id}`}>Open</Link>
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>{formatAddress(p)}</p>
                    <DetailList
                      items={[
                        { label: "Access", value: p.accessNotes },
                        { label: "Parking", value: p.parkingNotes },
                        { label: "Pets", value: p.petNotes },
                        {
                          label: "Keys",
                          value: p.keyInfo && (
                            <span className="inline-flex items-center gap-1">
                              <KeyRound className="size-3.5" />
                              {p.keyInfo}
                            </span>
                          ),
                        },
                      ]}
                    />
                    <p className="text-muted-foreground text-xs">
                      {p.equipment.length} units · {p._count.jobs} jobs
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="equipment" className="mt-2">
          {equipment.length === 0 ? (
            <EmptyState
              title="No equipment recorded"
              description="Add units from a property page."
            />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Unit</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Installed</TableHead>
                    <TableHead className="pr-4">Warranty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-4 font-medium">
                        <Link href={`/equipment/${e.id}`} className="hover:underline">
                          {e.brand} {e.model}
                        </Link>
                        {e.capacityKw ? (
                          <span className="text-muted-foreground"> · {e.capacityKw}kW</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{EQUIPMENT_TYPE_LABELS[e.type]}</TableCell>
                      <TableCell>{e.location ?? "–"}</TableCell>
                      <TableCell>{e.property.label ?? e.property.addressLine1}</TableCell>
                      <TableCell>{e.installDate ? formatDate(e.installDate) : "–"}</TableCell>
                      <TableCell className="pr-4">
                        <ExpiryBadge date={e.warrantyExpiresAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="quotes" className="mt-2">
          <QuotesMiniTable quotes={client.quotes} />
        </TabsContent>
        <TabsContent value="jobs" className="mt-2">
          <JobsMiniTable jobs={client.jobs} />
        </TabsContent>
        <TabsContent value="invoices" className="mt-2">
          <InvoicesMiniTable invoices={client.invoices} />
        </TabsContent>
        <TabsContent value="payments" className="mt-2">
          <PaymentsMiniTable payments={client.payments} />
        </TabsContent>
        <TabsContent value="activity" className="mt-2 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Timeline items={client.timeline} showEntity />
          </div>
          {canEdit && (
            <Card>
              <CardHeader>
                <CardTitle>Add note</CardTitle>
              </CardHeader>
              <CardContent>
                <NoteForm entityType="CLIENT" entityId={client.id} />
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
