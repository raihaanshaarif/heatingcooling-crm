import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { listTeam } from "@/server/team/queries";
import { PageHeader } from "@/components/shared/page-header";
import { NewRecordDialog } from "@/components/shared/new-record-dialog";
import { TeamTable } from "@/components/team/team-table";
import { UserForm } from "@/components/team/user-form";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await requirePermission("view", "team");
  const team = await listTeam();
  return (
    <>
      <PageHeader
        title="Team"
        description="Staff, roles, calendar colours and licences (ARC, gas, electrical)."
        actions={
          can(user, "create", "users") && (
            <NewRecordDialog label="Add user" title="Add user" wide>
              <UserForm />
            </NewRecordDialog>
          )
        }
      />
      <TeamTable data={team} showCosts={can(user, "view", "priceBookCosts")} />
    </>
  );
}
