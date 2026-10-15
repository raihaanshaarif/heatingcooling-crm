import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getClientOptions } from "@/server/clients/queries";
import { getTechnicianOptions, listUnscheduledJobs } from "@/server/jobs/queries";
import { PageHeader } from "@/components/shared/page-header";
import { ScheduleBoard } from "@/components/schedule/schedule-board";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage() {
  const user = await requirePermission("view", "schedule");
  const canEdit = can(user, "update", "schedule") && can(user, "create", "jobs");
  const [technicians, clients, unscheduled] = await Promise.all([
    getTechnicianOptions(),
    canEdit ? getClientOptions() : [],
    listUnscheduledJobs(),
  ]);
  return (
    <>
      <PageHeader
        title="Schedule"
        description="Select a time to book a job. Drag to reschedule, drag the edge to change the length."
      />
      <ScheduleBoard
        technicians={technicians}
        clients={clients}
        unscheduled={unscheduled}
        canEdit={canEdit}
      />
    </>
  );
}
