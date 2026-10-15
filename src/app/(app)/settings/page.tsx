import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resolveTemplates } from "@/lib/email/templates";
import { cn } from "@/lib/utils";
import { getSettings } from "@/server/settings";
import { templateItems } from "@/server/jobs/service";
import { listTeam } from "@/server/team/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { NewRecordDialog } from "@/components/shared/new-record-dialog";
import {
  BusinessSettingsForm,
  InvoicingSettingsForm,
  LogoUpload,
  NumberingSettingsForm,
} from "@/components/settings/settings-forms";
import { NextNumberForm } from "@/components/settings/next-number-form";
import { EmailTemplatesForm } from "@/components/settings/email-templates-form";
import { ChecklistTemplates } from "@/components/settings/checklist-templates";
import { TeamTable } from "@/components/team/team-table";
import { UserForm } from "@/components/team/user-form";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  { value: "business", label: "Business" },
  { value: "invoicing", label: "Invoicing" },
  { value: "numbering", label: "Numbering" },
  { value: "email", label: "Email templates" },
  { value: "checklists", label: "Checklists" },
  { value: "users", label: "Users" },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission("view", "settings");
  const { tab: requested } = await searchParams;
  const tab = TABS.some((t) => t.value === requested) ? requested! : "business";
  const settings = await getSettings();

  let content: React.ReactNode = null;
  if (tab === "business") {
    content = (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Logo</CardTitle>
          </CardHeader>
          <CardContent>
            <LogoUpload logoUrl={settings.logoUrl} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Business details</CardTitle>
            <CardDescription>Shown on quotes, tax invoices and emails.</CardDescription>
          </CardHeader>
          <CardContent>
            <BusinessSettingsForm settings={settings} />
          </CardContent>
        </Card>
      </div>
    );
  } else if (tab === "invoicing") {
    content = (
      <Card>
        <CardHeader>
          <CardTitle>GST, terms & bank details</CardTitle>
          <CardDescription>Bank details are printed on invoices for EFT payments.</CardDescription>
        </CardHeader>
        <CardContent>
          <InvoicingSettingsForm settings={settings} />
        </CardContent>
      </Card>
    );
  } else if (tab === "numbering") {
    const counters = await db.counter.findMany();
    const last = (key: string) => counters.find((c) => c.key === key)?.value ?? 0;
    content = (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Prefixes</CardTitle>
            <CardDescription>
              Documents are numbered like {settings.invoicePrefix}-0001. Changing a prefix
              doesn&apos;t renumber existing documents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NumberingSettingsForm settings={settings} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next numbers</CardTitle>
            <CardDescription>
              Continuing from another system? Set where numbering picks up. Numbers can only move
              forward.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <NextNumberForm
              counterKey="QUOTE"
              label="Quote"
              prefix={settings.quotePrefix}
              next={last("QUOTE") + 1}
            />
            <NextNumberForm
              counterKey="JOB"
              label="Job"
              prefix={settings.jobPrefix}
              next={last("JOB") + 1}
            />
            <NextNumberForm
              counterKey="INVOICE"
              label="Invoice"
              prefix={settings.invoicePrefix}
              next={last("INVOICE") + 1}
            />
            <NextNumberForm
              counterKey="CREDIT_NOTE"
              label="Credit note"
              prefix={settings.creditNotePrefix}
              next={last("CREDIT_NOTE") + 1}
            />
          </CardContent>
        </Card>
      </div>
    );
  } else if (tab === "email") {
    content = (
      <Card>
        <CardHeader>
          <CardTitle>Email templates</CardTitle>
          <CardDescription>
            Wording for emails sent to clients. Emails go out through Resend when RESEND_API_KEY is
            set; otherwise they&apos;re logged to the server console.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmailTemplatesForm templates={resolveTemplates(settings.emailTemplates)} />
        </CardContent>
      </Card>
    );
  } else if (tab === "checklists") {
    const templates = await db.jobChecklistTemplate.findMany({ orderBy: { name: "asc" } });
    content = (
      <ChecklistTemplates
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          jobType: t.jobType,
          serviceCategory: t.serviceCategory,
          items: templateItems(t.items),
          active: t.active,
        }))}
      />
    );
  } else {
    const team = await listTeam();
    content = (
      <div className="space-y-4">
        <div className="flex justify-end">
          <NewRecordDialog label="Add user" title="Add user" wide>
            <UserForm />
          </NewRecordDialog>
        </div>
        <TeamTable data={team} showCosts />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Settings" />
      <nav className="mb-4 flex flex-wrap gap-1 border-b" aria-label="Settings sections">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={`/settings?tab=${t.value}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === t.value
                ? "border-primary font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="max-w-4xl">{content}</div>
    </>
  );
}
