import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getClientOptions } from "@/server/clients/queries";
import { getTechnicianOptions, listJobs } from "@/server/jobs/queries";
import { PageHeader } from "@/components/shared/page-header";
import { NewRecordDialog } from "@/components/shared/new-record-dialog";
import { JobsTable } from "@/components/jobs/jobs-table";
import { JobForm } from "@/components/jobs/job-form";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; propertyId?: string }>;
}) {
  const user = await requirePermission("view", "schedule");
  const params = await searchParams;
  const [jobs, technicians, clients] = await Promise.all([
    listJobs(),
    getTechnicianOptions(),
    can(user, "create", "jobs") ? getClientOptions() : [],
  ]);
  const client = clients.find((c) => c.id === params.clientId);
  return (
    <>
      <PageHeader
        title="Jobs"
        description="Every service, repair, installation and maintenance visit."
        actions={
          can(user, "create", "jobs") && (
            <NewRecordDialog label="New job" title="New job" wide>
              <JobForm
                clients={clients}
                technicians={technicians}
                defaults={{
                  clientId: client?.id,
                  propertyId: params.propertyId ?? client?.properties[0]?.id,
                }}
              />
            </NewRecordDialog>
          )
        }
      />
      <JobsTable data={jobs} technicians={technicians} />
    </>
  );
}
