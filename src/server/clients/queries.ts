import "server-only";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { getTimeline } from "@/server/activity/queries";

const OUTSTANDING = ["SENT", "PARTIALLY_PAID", "OVERDUE"] as const;

export async function listClients() {
  const [clients, balances] = await Promise.all([
    db.client.findMany({
      where: { deletedAt: null },
      include: {
        properties: { select: { suburb: true }, take: 1, orderBy: { createdAt: "asc" } },
        _count: { select: { properties: true, jobs: { where: { deletedAt: null } } } },
      },
      orderBy: { name: "asc" },
    }),
    db.invoice.groupBy({
      by: ["clientId"],
      where: { deletedAt: null, status: { in: [...OUTSTANDING] } },
      _sum: { balanceCents: true },
    }),
  ]);
  const balanceMap = new Map(balances.map((b) => [b.clientId, b._sum.balanceCents ?? 0]));
  return clients.map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    companyName: c.companyName,
    email: c.email,
    phone: c.phone,
    suburb: c.billingSuburb ?? c.properties[0]?.suburb ?? null,
    tags: c.tags,
    source: c.source,
    doNotService: c.doNotService,
    propertyCount: c._count.properties,
    jobCount: c._count.jobs,
    outstandingCents: balanceMap.get(c.id) ?? 0,
    createdAt: c.createdAt,
  }));
}
export type ClientRow = Awaited<ReturnType<typeof listClients>>[number];

export async function getClient(id: string) {
  const client = await db.client.findFirst({
    where: { id, deletedAt: null },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      properties: {
        orderBy: { createdAt: "asc" },
        include: {
          equipment: { orderBy: { createdAt: "asc" } },
          _count: { select: { jobs: true } },
        },
      },
      leads: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      quotes: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      jobs: {
        where: { deletedAt: null },
        orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
        include: {
          assignments: { include: { user: { select: { name: true, color: true } } } },
          property: true,
        },
      },
      invoices: { where: { deletedAt: null }, orderBy: { issueDate: "desc" } },
      payments: { orderBy: { paidAt: "desc" }, include: { invoice: { select: { number: true } } } },
      maintenancePlans: { orderBy: { nextDueDate: "asc" }, include: { property: true } },
    },
  });
  if (!client) return null;

  const timeline = await getTimeline([
    { entityType: "CLIENT", ids: [client.id] },
    { entityType: "LEAD", ids: client.leads.map((l) => l.id) },
    { entityType: "QUOTE", ids: client.quotes.map((q) => q.id) },
    { entityType: "JOB", ids: client.jobs.map((j) => j.id) },
    { entityType: "INVOICE", ids: client.invoices.map((i) => i.id) },
  ]);

  const lifetimeValueCents = client.payments.reduce((s, p) => s + p.amountCents, 0);
  const outstandingCents = client.invoices
    .filter((i) => (OUTSTANDING as readonly string[]).includes(i.status))
    .reduce((s, i) => s + i.balanceCents, 0);
  const lastCompletedJob = client.jobs.find(
    (j) => j.status === "COMPLETED" || j.status === "INVOICED",
  );

  return {
    ...client,
    properties: client.properties.map((p) => ({
      ...p,
      equipment: p.equipment.map((e) => ({ ...e, capacityKw: toNumber(e.capacityKw) })),
    })),
    timeline,
    lifetimeValueCents,
    outstandingCents,
    lastServiceAt: lastCompletedJob?.actualEnd ?? lastCompletedJob?.scheduledStart ?? null,
  };
}
export type ClientDetail = NonNullable<Awaited<ReturnType<typeof getClient>>>;

/** Clients with their properties, for pickers in quote / job / invoice forms. */
export async function getClientOptions() {
  const clients = await db.client.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      companyName: true,
      doNotService: true,
      properties: {
        select: { id: true, label: true, addressLine1: true, suburb: true, postcode: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  return clients.map((c) => ({
    id: c.id,
    name: c.companyName ? `${c.name} (${c.companyName})` : c.name,
    doNotService: c.doNotService,
    properties: c.properties.map((p) => ({
      id: p.id,
      label: `${p.label ? `${p.label}: ` : ""}${p.addressLine1}, ${p.suburb} ${p.postcode}`,
    })),
  }));
}
export type ClientOption = Awaited<ReturnType<typeof getClientOptions>>[number];

export async function getProperty(id: string) {
  const property = await db.property.findUnique({
    where: { id },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          companyName: true,
          phone: true,
          email: true,
          deletedAt: true,
        },
      },
      equipment: {
        orderBy: { createdAt: "asc" },
        include: {
          jobs: {
            include: { job: { select: { scheduledStart: true, actualEnd: true, status: true } } },
          },
        },
      },
      jobs: {
        where: { deletedAt: null },
        orderBy: [{ scheduledStart: "desc" }],
        include: { assignments: { include: { user: { select: { name: true } } } } },
      },
      maintenancePlans: { orderBy: { nextDueDate: "asc" } },
    },
  });
  if (!property || property.client.deletedAt) return null;
  return {
    ...property,
    equipment: property.equipment.map((e) => {
      const done = e.jobs
        .filter((j) => j.job.status === "COMPLETED" || j.job.status === "INVOICED")
        .map((j) => j.job.actualEnd ?? j.job.scheduledStart)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime());
      const { jobs: _jobs, ...rest } = e;
      return {
        ...rest,
        capacityKw: toNumber(e.capacityKw),
        lastServicedAt: done[0] ?? null,
        jobCount: e.jobs.length,
      };
    }),
  };
}
