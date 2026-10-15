import type { Metadata } from "next";
import type { EntityType } from "@prisma/client";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { parseDateRange } from "@/lib/dates";
import { PageHeader } from "@/components/shared/page-header";
import { AuditTable } from "@/components/audit/audit-table";

export const metadata: Metadata = { title: "Audit log" };

const LINKS: Partial<Record<EntityType, string>> = {
  LEAD: "/leads/",
  CLIENT: "/clients/",
  PROPERTY: "/properties/",
  EQUIPMENT: "/equipment/",
  QUOTE: "/quotes/",
  JOB: "/jobs/",
  INVOICE: "/invoices/",
  USER: "/team/",
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePermission("view", "auditLog");
  const range = parseDateRange(await searchParams);
  const entries = await db.auditLog.findMany({
    where: { createdAt: { gte: range.from ?? undefined, lt: range.to ?? undefined } },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const rows = entries.map((e) => ({
    id: e.id,
    createdAt: e.createdAt,
    userName: e.user?.name ?? "System",
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    href: LINKS[e.entityType] ? `${LINKS[e.entityType]}${e.entityId}` : null,
    changes: e.changes ? JSON.stringify(e.changes, null, 2) : null,
  }));
  const uniq = (values: string[]) => [...new Set(values)].sort();
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every create, update and delete, with who did it and what changed. Showing the latest 2,000 entries for the selected dates."
      />
      <AuditTable
        data={rows}
        users={uniq(rows.map((r) => r.userName))}
        actions={uniq(rows.map((r) => r.action))}
        entities={uniq(rows.map((r) => r.entityType))}
      />
    </>
  );
}
