import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { addMelbourneDays, endOfMelbourneDay } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { PLAN_FREQUENCY_MONTHS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { getClientOptions } from "@/server/clients/queries";
import { listPlans } from "@/server/maintenance/queries";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { NewRecordDialog } from "@/components/shared/new-record-dialog";
import { PlanForm } from "@/components/maintenance/plan-form";
import { PlansTable } from "@/components/maintenance/plans-table";

export const metadata: Metadata = { title: "Maintenance" };

const WINDOWS = [
  { value: "30", label: "Due in 30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All plans" },
];

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ due?: string }>;
}) {
  const user = await requirePermission("view", "maintenance");
  const { due = "30" } = await searchParams;
  const [plans, clients] = await Promise.all([listPlans(), getClientOptions()]);
  const days = Number(due);
  const visible = Number.isFinite(days)
    ? plans.filter(
        (p) => p.active && p.nextDueDate <= endOfMelbourneDay(addMelbourneDays(new Date(), days)),
      )
    : plans;
  const active = plans.filter((p) => p.active);
  const annualValue = active.reduce(
    (s, p) => s + p.priceCents * (12 / PLAN_FREQUENCY_MONTHS[p.frequency]),
    0,
  );
  const overdue = active.filter((p) => p.nextDueDate < new Date()).length;
  return (
    <>
      <PageHeader
        title="Maintenance plans"
        description="Recurring service agreements. Completing a plan's job rolls the next due date forward."
        actions={
          can(user, "create", "maintenance") && (
            <NewRecordDialog label="New plan" title="New maintenance plan" wide>
              <PlanForm clients={clients} />
            </NewRecordDialog>
          )
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Active plans" value={active.length} />
        <StatCard label="Overdue" value={overdue} tone={overdue ? "danger" : "default"} />
        <StatCard
          label="Recurring revenue"
          value={formatCents(Math.round(annualValue))}
          hint="per year, ex GST"
        />
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {WINDOWS.map((w) => (
          <Link
            key={w.value}
            href={`/maintenance?due=${w.value}`}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              due === w.value
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-muted",
            )}
          >
            {w.label}
          </Link>
        ))}
      </div>
      <PlansTable
        data={visible}
        clients={clients}
        canEdit={can(user, "update", "maintenance")}
        canBook={can(user, "create", "jobs")}
      />
    </>
  );
}
