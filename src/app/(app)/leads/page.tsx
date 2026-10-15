import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getStaffOptions, listLeads } from "@/server/leads/queries";
import { PageHeader } from "@/components/shared/page-header";
import { NewRecordDialog } from "@/components/shared/new-record-dialog";
import { LeadsView } from "@/components/leads/leads-view";
import { LeadForm } from "@/components/leads/lead-form";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePermission("view", "leads");
  const range = await searchParams;
  const [leads, staff] = await Promise.all([listLeads(range), getStaffOptions()]);
  return (
    <>
      <PageHeader
        title="Leads"
        description="Every enquiry from first contact to won or lost."
        actions={
          can(user, "create", "leads") && (
            <NewRecordDialog label="New lead" title="New lead" wide>
              <LeadForm staff={staff} />
            </NewRecordDialog>
          )
        }
      />
      <LeadsView data={leads} staff={staff} />
    </>
  );
}
