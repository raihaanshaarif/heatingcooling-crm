import type { Metadata } from "next";
import { CalendarDays, Download, Globe, Mail, MessageSquare, Package } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
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
      status: <Status ready={false} phase="Phase 2" />,
      body: "On-my-way texts and appointment / service reminders. Provider interface in src/lib/sms.",
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
      status: <Status ready={false} phase="Phase 3" />,
      body: "Suppliers, stock levels per van and warehouse, auto-deduct parts used on jobs. Database tables (Supplier, InventoryItem) already exist.",
    },
  ];
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connections to other services. Phase 2 and 3 items are planned and stubbed in the code."
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
