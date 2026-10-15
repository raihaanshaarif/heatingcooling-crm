import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDate, toDateInput } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  COST_REPORTS,
  REPORT_IDS,
  getReport,
  type Report,
  type ReportId,
} from "@/server/reports/queries";
import { rangePresets, resolveRange } from "@/server/reports/range";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { SimpleBarChart } from "@/components/charts/simple-bar-chart";
import { ReportRange } from "@/components/reports/report-range";
import { ReportTable } from "@/components/reports/report-table";

export const metadata: Metadata = { title: "Reports" };

const LABELS: Record<ReportId, string> = {
  "revenue-by-month": "Revenue by month",
  "revenue-by-category": "By service category",
  "revenue-by-technician": "By technician",
  "lead-sources": "Lead sources & ROI",
  "quote-conversion": "Quote conversion",
  "aged-receivables": "Aged receivables",
  "job-profitability": "Job profitability",
  "top-clients": "Top clients",
  "service-due": "Due for service",
};

function ReportChart({ report }: { report: Report }) {
  const rows = report.rows as Record<string, string | number>[];
  switch (report.id) {
    case "revenue-by-month":
      return (
        <SimpleBarChart
          data={rows}
          xKey="month"
          series={[
            { key: "exGst", label: "Ex GST" },
            { key: "gst", label: "GST" },
          ]}
          money
          stacked
        />
      );
    case "revenue-by-category":
      return (
        <SimpleBarChart
          data={rows}
          xKey="category"
          series={[{ key: "revenue", label: "Revenue" }]}
          money
          layout="vertical"
        />
      );
    case "revenue-by-technician":
      return (
        <SimpleBarChart
          data={rows}
          xKey="technician"
          series={[{ key: "revenue", label: "Revenue" }]}
          money
          layout="vertical"
        />
      );
    case "lead-sources":
      return (
        <SimpleBarChart
          data={rows}
          xKey="source"
          series={[
            { key: "won", label: "Won" },
            { key: "lost", label: "Lost" },
            { key: "leads", label: "All leads" },
          ]}
          layout="vertical"
        />
      );
    case "quote-conversion":
      return (
        <SimpleBarChart
          data={rows}
          xKey="month"
          series={[
            { key: "accepted", label: "Accepted" },
            { key: "declined", label: "Declined / expired" },
          ]}
          stacked
        />
      );
    case "aged-receivables": {
      const t = report.totals ?? {};
      const data = ["current", "1-30", "31-60", "61-90", "90+"].map((b) => ({
        bucket: b === "current" ? "Current" : `${b} days`,
        balance: Number(t[b]) || 0,
      }));
      return (
        <SimpleBarChart
          data={data}
          xKey="bucket"
          series={[{ key: "balance", label: "Balance", color: "var(--chart-5)" }]}
          money
        />
      );
    }
    case "top-clients":
      return (
        <SimpleBarChart
          data={rows.slice(0, 10)}
          xKey="client"
          series={[{ key: "received", label: "Received" }]}
          money
          layout="vertical"
        />
      );
    default:
      return null;
  }
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; from?: string; to?: string }>;
}) {
  const user = await requirePermission("view", "reports");
  const params = await searchParams;
  const available = REPORT_IDS.filter(
    (id) => !COST_REPORTS.includes(id) || can(user, "view", "priceBookCosts"),
  );
  const id = (available as readonly string[]).includes(params.report ?? "")
    ? (params.report as ReportId)
    : available[0];
  const range = resolveRange(params);
  const report = await getReport(id, range);
  const from = toDateInput(range.from);
  const to = toDateInput(new Date(range.to.getTime() - 1));
  const query = (r: ReportId) => `/reports?report=${r}&from=${from}&to=${to}`;
  const chart = <ReportChart report={report} />;
  const asAtToday = id === "aged-receivables" || id === "service-due";

  return (
    <>
      <PageHeader
        title="Reports"
        description="Pick a report and a date range. Every report exports to CSV for your accountant."
      />
      <div className="mb-4 flex flex-wrap gap-1">
        {available.map((r) => (
          <Link
            key={r}
            href={query(r)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              r === id ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
            )}
          >
            {LABELS[r]}
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>{report.title}</CardTitle>
              <p className="text-muted-foreground mt-1 text-sm">
                {report.description}{" "}
                {asAtToday
                  ? "As at today."
                  : `${formatDate(range.from)} – ${formatDate(new Date(range.to.getTime() - 1))}.`}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/reports/${id}?from=${from}&to=${to}`}>
                <Download /> Export CSV
              </a>
            </Button>
          </div>
          {!asAtToday && <ReportRange from={from} to={to} presets={rangePresets()} />}
        </CardHeader>
        <CardContent className="space-y-6">
          {report.rows.length > 0 && chart}
          <ReportTable report={report} />
        </CardContent>
      </Card>
    </>
  );
}
