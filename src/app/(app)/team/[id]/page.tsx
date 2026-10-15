import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { LICENCE_TYPE_LABELS, ROLE_LABELS } from "@/lib/labels";
import { formatPhoneAU } from "@/lib/utils";
import { getTeamMember } from "@/server/team/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { DetailList } from "@/components/shared/detail-list";
import { ExpiryBadge } from "@/components/shared/status-badge";
import { FormDialogButton } from "@/components/shared/form-dialog-button";
import { JobsMiniTable } from "@/components/shared/record-tables";
import { UserForm } from "@/components/team/user-form";
import { LicenceForm } from "@/components/team/licence-form";
import { DeleteLicenceButton } from "@/components/team/delete-licence-button";

export const metadata: Metadata = { title: "Team member" };

export default async function TeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("view", "team");
  const { id } = await params;
  const member = await getTeamMember(id);
  if (!member) notFound();
  const canManage = can(user, "update", "users");
  return (
    <>
      <PageHeader
        back={{ href: "/team", label: "Team" }}
        title={
          <span className="inline-flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ backgroundColor: member.color }} />
            {member.name}
          </span>
        }
        badge={
          <>
            <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
            {!member.active && <Badge variant="muted">Inactive</Badge>}
          </>
        }
        actions={
          canManage && (
            <FormDialogButton label="Edit" icon={<Pencil />} title={`Edit ${member.name}`} wide>
              <UserForm user={member} />
            </FormDialogButton>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Licences &amp; tickets</CardTitle>
              {canManage && (
                <FormDialogButton label="Add licence" icon={<Plus />} title="Add licence" size="sm">
                  <LicenceForm userId={member.id} />
                </FormDialogButton>
              )}
            </CardHeader>
            <CardContent>
              {member.licences.length === 0 ? (
                <p className="text-muted-foreground text-sm">No licences recorded.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {member.licences.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                      <div>
                        <p className="font-medium">{LICENCE_TYPE_LABELS[l.type]}</p>
                        <p className="text-muted-foreground text-xs">
                          {l.number}
                          {l.expiresAt && ` · expires ${formatDate(l.expiresAt)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <ExpiryBadge date={l.expiresAt} />
                        {canManage && (
                          <>
                            <FormDialogButton
                              label=""
                              icon={<Pencil />}
                              title="Edit licence"
                              size="icon"
                              variant="ghost"
                            >
                              <LicenceForm userId={member.id} licence={l} />
                            </FormDialogButton>
                            <DeleteLicenceButton id={l.id} />
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <JobsMiniTable jobs={member.jobAssignments.map((a) => a.job)} />
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Email", value: member.email },
                { label: "Phone", value: formatPhoneAU(member.phone) },
                {
                  label: "Hourly cost",
                  value: formatCents(member.hourlyCostCents),
                  hidden: !can(user, "view", "priceBookCosts"),
                },
                { label: "Since", value: formatDate(member.createdAt) },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
