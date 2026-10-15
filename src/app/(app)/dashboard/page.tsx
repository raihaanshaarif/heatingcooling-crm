import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CreditCard,
  FileText,
  Receipt,
  ShieldAlert,
  UserPlus,
  Wrench,
} from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatCents, percentChange } from "@/lib/money";
import { formatTime, relativeDays } from "@/lib/dates";
import { daysOverdue } from "@/lib/invoice-status";
import { LEAD_SOURCE_LABELS, SERVICE_CATEGORY_LABELS } from "@/lib/labels";
import { getDashboard } from "@/server/dashboard/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { JobStatusBadge, LeadStatusBadge } from "@/components/shared/status-badge";
import { SimpleBarChart } from "@/components/charts/simple-bar-chart";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requirePermission("view", "dashboard");
  const d = await getDashboard();
  const change = percentChange(d.revenueThisMonth, d.revenueLastMonth);
  const quickActions = [
    { label: "New lead", href: "/leads?new=1", icon: UserPlus, show: can(user, "create", "leads") },
    {
      label: "New quote",
      href: "/quotes/new",
      icon: FileText,
      show: can(user, "create", "quotes"),
    },
    { label: "New job", href: "/jobs?new=1", icon: Wrench, show: can(user, "create", "jobs") },
    {
      label: "New invoice",
      href: "/invoices/new",
      icon: Receipt,
      show: can(user, "create", "invoices"),
    },
    {
      label: "Record payment",
      href: "/payments?new=1",
      icon: CreditCard,
      show: can(user, "create", "payments"),
    },
  ].filter((a) => a.show);
  const alerts = [
    d.unscheduled > 0 && {
      text: `${d.unscheduled} job${d.unscheduled > 1 ? "s" : ""} waiting to be scheduled`,
      href: "/schedule",
    },
    d.plansDue > 0 && {
      text: `${d.plansDue} maintenance plan${d.plansDue > 1 ? "s" : ""} due in the next 30 days`,
      href: "/maintenance",
    },
    d.warranties > 0 && {
      text: `${d.warranties} equipment warrant${d.warranties > 1 ? "ies" : "y"} expiring within 30 days`,
      href: "/equipment",
    },
    ...d.licences.map((l) => ({
      text: `${l.user.name}'s licence ${l.number} ${l.expiresAt && l.expiresAt < new Date() ? "has expired" : `expires ${relativeDays(l.expiresAt!)}`}`,
      href: `/team/${l.user.id}`,
    })),
  ].filter((a): a is { text: string; href: string } => !!a);

  return (
    <>
      <PageHeader
        title={`G'day, ${user.name.split(" ")[0]}`}
        description="Here's how the business is tracking."
        actions={quickActions.map((a) => (
          <Button key={a.href} asChild variant="outline" size="sm">
            <Link href={a.href}>
              <a.icon /> {a.label}
            </Link>
          </Button>
        ))}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {can(user, "view", "reports") && (
          <StatCard
            label="Revenue this month"
            value={formatCents(d.revenueThisMonth)}
            hint={
              change === null
                ? `Last month ${formatCents(d.revenueLastMonth)}`
                : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}% vs last month`
            }
            href="/reports"
          />
        )}
        <StatCard
          label="Outstanding"
          value={formatCents(d.outstandingCents)}
          hint={`${formatCents(d.overdueCents)} overdue (${d.overdueCount})`}
          tone={d.overdueCount ? "danger" : "default"}
          href="/invoices?status=OVERDUE"
        />
        <StatCard
          label="Jobs today"
          value={d.todaysJobs.length}
          hint={`${d.unscheduled} unscheduled`}
          href="/schedule"
        />
        <StatCard
          label="New leads this week"
          value={d.leadsThisWeek}
          hint={d.winRate === null ? "No closed leads yet" : `${d.winRate}% win rate (90 days)`}
          href="/leads"
        />
        <StatCard
          label="Quotes awaiting reply"
          value={formatCents(d.openQuotesCents)}
          hint={`${d.openQuotesCount} quotes`}
          href="/quotes?status=SENT&status=VIEWED"
        />
      </div>

      {alerts.length > 0 && (
        <Card className="mt-4 border-amber-300 dark:border-amber-800">
          <CardContent className="space-y-1.5">
            {alerts.map((a) => (
              <Link
                key={a.text}
                href={a.href}
                className="flex items-center gap-2 text-sm hover:underline"
              >
                <ShieldAlert className="size-4 shrink-0 text-amber-600" /> {a.text}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Today&apos;s schedule</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/schedule">Open schedule</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {d.todaysJobs.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Nothing booked today" />
            ) : (
              <ul className="divide-y">
                {d.todaysJobs.map((j) => (
                  <li key={j.id}>
                    <Link
                      href={`/jobs/${j.id}`}
                      className="hover:bg-muted/40 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5"
                    >
                      <span className="w-16 shrink-0 text-sm font-medium tabular-nums">
                        {formatTime(j.scheduledStart)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {j.client.name}
                          {j.property?.suburb && (
                            <span className="text-muted-foreground font-normal">
                              {" "}
                              · {j.property.suburb}
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {j.number} · {j.title}
                        </span>
                      </span>
                      <span className="hidden items-center gap-2 sm:flex">
                        {j.assignments.map((a) => (
                          <span
                            key={a.user.name}
                            className="inline-flex items-center gap-1 text-xs"
                          >
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: a.user.color }}
                            />
                            {a.user.name.split(" ")[0]}
                          </span>
                        ))}
                      </span>
                      <JobStatusBadge status={j.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent leads</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/leads">All leads</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {d.recentLeads.length === 0 ? (
              <EmptyState title="No leads yet" />
            ) : (
              <ul className="space-y-3">
                {d.recentLeads.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/leads/${l.id}`}
                      className="flex items-start justify-between gap-2 hover:underline"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{l.name}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {LEAD_SOURCE_LABELS[l.source]}
                          {l.serviceCategory && ` · ${SERVICE_CATEGORY_LABELS[l.serviceCategory]}`}
                          {l.suburb && ` · ${l.suburb}`} · {relativeDays(l.createdAt)}
                        </span>
                      </span>
                      <LeadStatusBadge status={l.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {can(user, "view", "reports") && (
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Revenue, last 12 months</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleBarChart
                data={d.revenue}
                xKey="month"
                series={[{ key: "revenue", label: "Revenue" }]}
                money
              />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Leads by source (90 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {d.leadsBySource.length === 0 ? (
              <EmptyState title="No leads in the last 90 days" />
            ) : (
              <SimpleBarChart
                data={d.leadsBySource}
                xKey="source"
                series={[{ key: "leads", label: "Leads", color: "var(--chart-2)" }]}
                layout="vertical"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive size-4" /> Overdue invoices
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/invoices?status=OVERDUE">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {d.overdueInvoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing overdue.</p>
          ) : (
            <ul className="divide-y">
              {d.overdueInvoices.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/invoices/${i.id}`}
                    className="hover:bg-muted/40 -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{i.number}</span> · {i.client.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-destructive text-xs">
                        {daysOverdue(i.dueDate)}d overdue
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCents(i.balanceCents)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
