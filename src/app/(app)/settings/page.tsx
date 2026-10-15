import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resolveTemplates } from "@/lib/email/templates";
import { getSmsConfig, SMS_PROVIDER_LABELS } from "@/lib/sms";
import { resolveSmsSettings } from "@/lib/sms/templates";
import { addMelbourneDays, formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getSettings } from "@/server/settings";
import { templateItems } from "@/server/jobs/service";
import { listTeam } from "@/server/team/queries";
import { listSmsLog, smsStats } from "@/server/sms/queries";
import { SMS_KIND_LABELS } from "@/server/sms/service";
import { Badge } from "@/components/ui/badge";
import { SmsSettingsForm } from "@/components/sms/sms-settings-form";
import { SMS_STATUS_LABELS, SmsLogTable } from "@/components/sms/sms-log-table";
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
import { XeroSettingsForm } from "@/components/xero/xero-settings-form";
import { XERO_JOB_STATUS_LABELS, XeroLogTable } from "@/components/xero/xero-log-table";
import { RetryAllFailedButton, SyncNowButton } from "@/components/xero/xero-connection-actions";
import { resolveXeroSettings } from "@/lib/xero/settings";
import { getXeroOptions, getXeroOverview, listXeroLog } from "@/server/xero/queries";
import { getRouteOverview } from "@/server/routes/queries";
import { GeocodeMissingButton, RouteSettingsForm } from "@/components/routes/route-settings";
import { RouteOverviewText } from "@/components/routes/route-overview";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  { value: "business", label: "Business" },
  { value: "invoicing", label: "Invoicing" },
  { value: "numbering", label: "Numbering" },
  { value: "email", label: "Email templates" },
  { value: "sms", label: "SMS" },
  { value: "sms-log", label: "SMS log" },
  { value: "xero", label: "Xero" },
  { value: "xero-log", label: "Xero sync log" },
  { value: "routes", label: "Routes" },
  { value: "checklists", label: "Checklists" },
  { value: "users", label: "Users" },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  await requirePermission("view", "settings");
  const { tab: requested, status: statusParam } = await searchParams;
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
  } else if (tab === "sms") {
    const config = getSmsConfig();
    content = (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            SMS texts
            {config.provider === "console" ? (
              <Badge variant="warning">Provider not set up</Badge>
            ) : (
              <Badge variant="success">{SMS_PROVIDER_LABELS[config.provider]}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Choose which texts go to clients automatically and what they say. Clients marked{" "}
            <em>No SMS</em> are never texted.{" "}
            {config.provider === "console" ? (
              <>
                Until a provider is connected (see{" "}
                <Link href="/integrations" className="underline">
                  Integrations
                </Link>
                ), texts are written to the SMS log but not sent.
              </>
            ) : (
              "Each SMS segment (160 characters, or 70 with emoji) is billed by your provider."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SmsSettingsForm settings={resolveSmsSettings(settings.smsSettings)} />
        </CardContent>
      </Card>
    );
  } else if (tab === "sms-log") {
    const status = (["SENT", "LOGGED", "SKIPPED", "FAILED"] as const).find(
      (s) => s === statusParam,
    );
    const [rows, stats] = await Promise.all([
      listSmsLog({ status }),
      smsStats(addMelbourneDays(new Date(), -30)),
    ]);
    const sentSegments = (stats.SENT?.segments ?? 0) + (stats.FAILED?.segments ?? 0);
    content = (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Last 30 days: {stats.SENT?.count ?? 0} sent ({sentSegments} SMS segments billed at most),{" "}
          {stats.LOGGED?.count ?? 0} logged only, {stats.SKIPPED?.count ?? 0} not sent,{" "}
          {stats.FAILED?.count ?? 0} failed.
        </p>
        <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
          {[undefined, "SENT", "LOGGED", "SKIPPED", "FAILED"].map((s) => (
            <Link
              key={s ?? "all"}
              href={`/settings?tab=sms-log${s ? `&status=${s}` : ""}`}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs",
                status === s ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {s ? SMS_STATUS_LABELS[s as keyof typeof SMS_STATUS_LABELS] : "All"}
            </Link>
          ))}
        </nav>
        <SmsLogTable rows={rows} kindLabels={SMS_KIND_LABELS} />
      </div>
    );
  } else if (tab === "xero") {
    const [overview, xeroOptions] = await Promise.all([getXeroOverview(), getXeroOptions()]);
    content = (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Xero
            {overview.state === "connected" ? (
              <Badge variant="success">Connected to {overview.tenantName}</Badge>
            ) : (
              <Badge variant="warning">
                {overview.state === "not-set-up" ? "Not set up" : "Not connected"}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            How invoices, credit notes and payments are coded when they&apos;re sent to Xero.{" "}
            {overview.state !== "connected" && (
              <>
                Connect Xero on the{" "}
                <Link href="/integrations" className="underline">
                  Integrations
                </Link>{" "}
                page to pick accounts and tax rates from your Xero organisation.
              </>
            )}
            {xeroOptions.error && (
              <span className="text-destructive block">
                Couldn&apos;t load accounts from Xero ({xeroOptions.error}), so codes can be typed
                in instead.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <XeroSettingsForm
            settings={resolveXeroSettings(settings.xeroSettings)}
            options={xeroOptions.options}
          />
        </CardContent>
      </Card>
    );
  } else if (tab === "xero-log") {
    const status = (["PENDING", "PROCESSING", "DONE", "FAILED", "CANCELLED"] as const).find(
      (s) => s === statusParam,
    );
    const [rows, overview] = await Promise.all([listXeroLog({ status }), getXeroOverview()]);
    content = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            {overview.state === "connected"
              ? `Connected to ${overview.tenantName}. ${overview.pending} waiting, ${overview.failed} failed${overview.retrying ? ` (${overview.retrying} will retry automatically)` : ""}.`
              : "Xero is not connected, so nothing is being sent."}
            {overview.lastSyncAt && ` Last sync ${formatDateTime(overview.lastSyncAt)}.`}
          </p>
          <span className="flex gap-2">
            {overview.failed > 0 && <RetryAllFailedButton />}
            <SyncNowButton />
          </span>
        </div>
        <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
          {[undefined, "PENDING", "FAILED", "DONE", "CANCELLED"].map((s) => (
            <Link
              key={s ?? "all"}
              href={`/settings?tab=xero-log${s ? `&status=${s}` : ""}`}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs",
                status === s ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {s ? XERO_JOB_STATUS_LABELS[s as keyof typeof XERO_JOB_STATUS_LABELS] : "All"}
            </Link>
          ))}
        </nav>
        <XeroLogTable rows={rows} canRetry={overview.state === "connected"} />
      </div>
    );
  } else if (tab === "routes") {
    const overview = await getRouteOverview();
    content = (
      <Card>
        <CardHeader>
          <CardTitle>Route planning</CardTitle>
          <CardDescription>
            {overview.googleConfigured
              ? "Using Google Maps for addresses and drive times."
              : "Estimating drive times from straight-line distances (add GOOGLE_MAPS_API_KEY for real drive times)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RouteSettingsForm routeDayStart={settings.routeDayStart} />
          <div className="text-muted-foreground space-y-2 text-sm">
            <RouteOverviewText overview={overview} />
            <GeocodeMissingButton />
          </div>
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
      <div className={tab === "sms-log" || tab === "xero-log" ? "max-w-6xl" : "max-w-4xl"}>
        {content}
      </div>
    </>
  );
}
