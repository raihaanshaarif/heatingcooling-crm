import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Download, Globe, Mail, MessageSquare, Package } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addMelbourneDays } from "@/lib/dates";
import { getSmsConfig, SMS_PROVIDER_LABELS } from "@/lib/sms";
import { isGoogleCalendarConfigured } from "@/lib/integrations/google-calendar";
import { appUrl } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Integrations" };

function Status({ ready, phase }: { ready: boolean; phase?: string }) {
  if (ready) return <Badge variant="success">Connected</Badge>;
  if (phase) return <Badge variant="muted">{phase}</Badge>;
  return <Badge variant="warning">Not configured</Badge>;
}

export default async function IntegrationsPage() {
  await requirePermission("view", "settings");
  const inventoryTracked = await db.inventoryItem.count({ where: { active: true } });
  const sms = getSmsConfig();
  const smsLast30 = await db.smsMessage.count({
    where: {
      createdAt: { gte: addMelbourneDays(new Date(), -30) },
      status: { in: ["SENT", "LOGGED"] },
    },
  });
  const webhookUrl = appUrl("/api/leads/webhook");
  const items = [
    {
      icon: Globe,
      title: "Website enquiry form",
      status: <Status ready={!!process.env.LEAD_WEBHOOK_SECRET} />,
      body: (
        <>
          POST enquiries to <code className="bg-muted rounded px-1">{webhookUrl}</code> with header{" "}
          <code className="bg-muted rounded px-1">x-api-key: LEAD_WEBHOOK_SECRET</code>. Leads
          appear instantly, duplicates within 24 hours are merged, and the office is notified. See
          the README for a curl example.
        </>
      ),
    },
    {
      icon: Mail,
      title: "Email (Resend)",
      status: <Status ready={!!process.env.RESEND_API_KEY} />,
      body: "Quotes, invoices, overdue reminders and service-due reminders. Without RESEND_API_KEY emails are logged to the server console instead.",
    },
    {
      icon: Download,
      title: "Xero export",
      status: <Badge variant="success">Available</Badge>,
      body: (
        <>
          Download sent invoices as a Xero sales-invoice import file (account code 200, GST on
          Income).{" "}
          <Button asChild size="sm" variant="outline" className="mt-2">
            <a href="/api/export/xero">Download all invoices</a>
          </Button>
          <span className="text-muted-foreground mt-1 block text-xs">
            Add ?from=YYYY-MM-DD&amp;to=YYYY-MM-DD to the link for a date range. Live Xero / MYOB
            sync is planned for Phase 3.
          </span>
        </>
      ),
    },
    {
      icon: MessageSquare,
      title: "SMS (Twilio / MessageMedia)",
      status:
        sms.provider === "console" ? (
          <Badge variant="warning">Not set up</Badge>
        ) : (
          <Badge variant="success">{SMS_PROVIDER_LABELS[sms.provider]}</Badge>
        ),
      body: (
        <>
          On-my-way texts, appointment reminders the day before, service-due reminders and
          (optional) overdue-invoice texts, plus one-off texts from client and job pages.{" "}
          {sms.provider === "console" ? (
            <>
              {sms.requested
                ? `SMS_PROVIDER is ${sms.requested} but ${sms.missing.join(", ")} ${sms.missing.length === 1 ? "is" : "are"} missing. `
                : "No provider yet. "}
              Texts are written to the SMS log but not sent. To connect: create a{" "}
              <strong>MessageMedia</strong> account (Australian, sinch.com/messagemedia) and add{" "}
              <code className="bg-muted rounded px-1">SMS_PROVIDER=messagemedia</code>,{" "}
              <code className="bg-muted rounded px-1">MESSAGEMEDIA_API_KEY</code> and{" "}
              <code className="bg-muted rounded px-1">MESSAGEMEDIA_API_SECRET</code>; or a{" "}
              <strong>Twilio</strong> account with{" "}
              <code className="bg-muted rounded px-1">SMS_PROVIDER=twilio</code>,{" "}
              <code className="bg-muted rounded px-1">TWILIO_ACCOUNT_SID</code>,{" "}
              <code className="bg-muted rounded px-1">TWILIO_AUTH_TOKEN</code> and{" "}
              <code className="bg-muted rounded px-1">SMS_FROM</code> (your Twilio number, sender
              name or Messaging Service SID). Then redeploy.
            </>
          ) : (
            `Sending from ${sms.provider === "twilio" ? (sms.messagingServiceSid ?? sms.from) : (sms.from ?? "MessageMedia's shared number")}.`
          )}{" "}
          {smsLast30 > 0 && `${smsLast30} text${smsLast30 === 1 ? "" : "s"} in the last 30 days.`}
          <span className="mt-2 flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/settings?tab=sms">SMS settings</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/settings?tab=sms-log">SMS log</Link>
            </Button>
          </span>
        </>
      ),
    },
    {
      icon: CalendarDays,
      title: "Google Calendar",
      status: <Status ready={isGoogleCalendarConfigured()} phase="Phase 3" />,
      body: "Push each technician's jobs into their own Google Calendar. Stub in src/lib/integrations/google-calendar.ts.",
    },
    {
      icon: Package,
      title: "Inventory & van stock",
      status: inventoryTracked ? (
        <Badge variant="success">In use</Badge>
      ) : (
        <Badge variant="warning">Not set up</Badge>
      ),
      body: (
        <>
          Stock in the warehouse and each technician&apos;s van, low-stock alerts, suppliers and
          deliveries. Parts added to a job are taken from the technician&apos;s van automatically.
          Built in, no API keys needed.{" "}
          {inventoryTracked
            ? `${inventoryTracked} part${inventoryTracked === 1 ? "" : "s"} tracked.`
            : "To start: add your suppliers, then on Inventory use Track item for each part you keep, and Receive stock to load the opening quantities."}
          <span className="mt-2 flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/inventory">Open Inventory</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/suppliers">Suppliers</Link>
            </Button>
          </span>
        </>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connections to other services. Phase 3 items are planned and stubbed in the code."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((i) => (
          <Card key={i.title}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <i.icon className="text-muted-foreground size-5" />
                <CardTitle>{i.title}</CardTitle>
              </div>
              {i.status}
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm">{i.body}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
