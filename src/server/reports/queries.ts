import "server-only";
import { db } from "@/lib/db";
import { AGE_BUCKETS, ageBucket, daysOverdue, deriveInvoiceStatus } from "@/lib/invoice-status";
import { addMelbourneDays, formatDate, startOfMelbourneMonth } from "@/lib/dates";
import { LEAD_SOURCE_LABELS, SERVICE_CATEGORY_LABELS } from "@/lib/labels";
import { lineTotalCents } from "@/lib/money";

export type ColumnType = "text" | "money" | "number" | "percent" | "date";
export interface ReportColumn {
  key: string;
  label: string;
  type?: ColumnType;
}
export type ReportRow = Record<string, string | number | null>;
export interface Report {
  id: ReportId;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow;
}

export const REPORT_IDS = [
  "revenue-by-month",
  "revenue-by-category",
  "revenue-by-technician",
  "lead-sources",
  "quote-conversion",
  "aged-receivables",
  "job-profitability",
  "top-clients",
  "service-due",
] as const;
export type ReportId = (typeof REPORT_IDS)[number];

export interface Range {
  from: Date;
  to: Date; // exclusive
}

export function defaultRange(now = new Date()): Range {
  return { from: startOfMelbourneMonth(now, -11), to: startOfMelbourneMonth(now, 1) };
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const sum = (rows: ReportRow[], key: string) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

/** Invoices issued in the range that count as revenue (not drafts or voids). */
async function issuedInvoices(range: Range) {
  return db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ["DRAFT", "VOID"] },
      issueDate: { gte: range.from, lt: range.to },
    },
    include: {
      client: { select: { id: true, name: true } },
      lineItems: true,
      job: {
        select: {
          serviceCategory: true,
          assignments: { select: { user: { select: { id: true, name: true } } } },
        },
      },
    },
  });
}

async function revenueByMonth(range: Range): Promise<Report> {
  const payments = await db.payment.findMany({
    where: { paidAt: { gte: range.from, lt: range.to }, invoice: { deletedAt: null } },
    include: { invoice: { select: { gstCents: true, totalCents: true } } },
  });
  const months: Date[] = [];
  for (let m = startOfMelbourneMonth(range.from); m < range.to; m = startOfMelbourneMonth(m, 1))
    months.push(m);
  const rows = months.map((start, i) => {
    const end = months[i + 1] ?? range.to;
    const inMonth = payments.filter((p) => p.paidAt >= start && p.paidAt < end);
    const received = inMonth.reduce((s, p) => s + p.amountCents, 0);
    // GST component of cash received, pro-rata to each invoice's GST share.
    const gst = inMonth.reduce(
      (s, p) =>
        s +
        (p.invoice.totalCents
          ? Math.round((p.amountCents * p.invoice.gstCents) / p.invoice.totalCents)
          : 0),
      0,
    );
    return {
      month: formatDate(start, "MMM yyyy"),
      payments: inMonth.length,
      received,
      gst,
      exGst: received - gst,
    };
  });
  return {
    id: "revenue-by-month",
    title: "Revenue by month",
    description: "Cash received (payments less refunds), with the GST component for your BAS.",
    columns: [
      { key: "month", label: "Month" },
      { key: "payments", label: "Payments", type: "number" },
      { key: "received", label: "Received inc GST", type: "money" },
      { key: "gst", label: "GST", type: "money" },
      { key: "exGst", label: "Ex GST", type: "money" },
    ],
    rows,
    totals: {
      month: "Total",
      payments: sum(rows, "payments"),
      received: sum(rows, "received"),
      gst: sum(rows, "gst"),
      exGst: sum(rows, "exGst"),
    },
  };
}

async function revenueByCategory(range: Range): Promise<Report> {
  const invoices = await issuedInvoices(range);
  const map = new Map<string, { invoices: number; revenue: number }>();
  for (const inv of invoices) {
    const key = inv.job?.serviceCategory
      ? SERVICE_CATEGORY_LABELS[inv.job.serviceCategory]
      : "No job / other";
    const row = map.get(key) ?? { invoices: 0, revenue: 0 };
    row.invoices += 1;
    row.revenue += inv.subtotalCents;
    map.set(key, row);
  }
  const total = [...map.values()].reduce((s, r) => s + r.revenue, 0);
  const rows = [...map.entries()]
    .map(([category, r]) => ({
      category,
      invoices: r.invoices,
      revenue: r.revenue,
      share: pct(r.revenue, total),
    }))
    .sort((a, b) => b.revenue - a.revenue);
  return {
    id: "revenue-by-category",
    title: "Revenue by service category",
    description: "Invoiced (ex GST) in the period, by the job's service category.",
    columns: [
      { key: "category", label: "Category" },
      { key: "invoices", label: "Invoices", type: "number" },
      { key: "revenue", label: "Revenue ex GST", type: "money" },
      { key: "share", label: "Share", type: "percent" },
    ],
    rows,
    totals: {
      category: "Total",
      invoices: sum(rows, "invoices"),
      revenue: total,
      share: total ? 100 : null,
    },
  };
}

async function revenueByTechnician(range: Range): Promise<Report> {
  const invoices = await issuedInvoices(range);
  const map = new Map<string, { name: string; jobs: Set<string>; revenue: number }>();
  for (const inv of invoices) {
    const techs = inv.job?.assignments.map((a) => a.user) ?? [];
    const share = techs.length ? Math.round(inv.subtotalCents / techs.length) : inv.subtotalCents;
    for (const t of techs.length ? techs : [{ id: "none", name: "Unassigned / no job" }]) {
      const row = map.get(t.id) ?? { name: t.name, jobs: new Set<string>(), revenue: 0 };
      if (inv.jobId) row.jobs.add(inv.jobId);
      row.revenue += share;
      map.set(t.id, row);
    }
  }
  const hours = await db.timeEntry.groupBy({
    by: ["userId"],
    where: { startedAt: { gte: range.from, lt: range.to }, minutes: { not: null } },
    _sum: { minutes: true },
  });
  const rows = [...map.entries()]
    .map(([id, r]) => {
      const minutes = hours.find((h) => h.userId === id)?._sum.minutes ?? 0;
      return {
        technician: r.name,
        jobs: r.jobs.size,
        revenue: r.revenue,
        hours: Math.round((minutes / 60) * 10) / 10,
        perHour: minutes > 0 ? Math.round(r.revenue / (minutes / 60)) : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
  return {
    id: "revenue-by-technician",
    title: "Revenue by technician",
    description: "Invoiced (ex GST) on jobs each technician worked; shared jobs are split evenly.",
    columns: [
      { key: "technician", label: "Technician" },
      { key: "jobs", label: "Jobs", type: "number" },
      { key: "hours", label: "Hours logged", type: "number" },
      { key: "revenue", label: "Revenue ex GST", type: "money" },
      { key: "perHour", label: "Per hour", type: "money" },
    ],
    rows,
    totals: {
      technician: "Total",
      jobs: null,
      hours: sum(rows, "hours"),
      revenue: sum(rows, "revenue"),
      perHour: null,
    },
  };
}

async function leadSources(range: Range): Promise<Report> {
  const leads = await db.lead.findMany({
    where: { deletedAt: null, createdAt: { gte: range.from, lt: range.to } },
    include: { quotes: { where: { deletedAt: null }, select: { status: true, totalCents: true } } },
  });
  const map = new Map<
    string,
    { leads: number; won: number; lost: number; quoted: number; wonValue: number }
  >();
  for (const l of leads) {
    const key = LEAD_SOURCE_LABELS[l.source];
    const row = map.get(key) ?? { leads: 0, won: 0, lost: 0, quoted: 0, wonValue: 0 };
    row.leads += 1;
    if (l.status === "WON") row.won += 1;
    if (l.status === "LOST") row.lost += 1;
    row.quoted += l.quotes.length > 0 ? 1 : 0;
    row.wonValue += l.quotes
      .filter((q) => q.status === "ACCEPTED")
      .reduce((s, q) => s + q.totalCents, 0);
    map.set(key, row);
  }
  const rows = [...map.entries()]
    .map(([source, r]) => ({ source, ...r, winRate: pct(r.won, r.won + r.lost) }))
    .sort((a, b) => b.leads - a.leads);
  const won = sum(rows, "won");
  const lost = sum(rows, "lost");
  return {
    id: "lead-sources",
    title: "Lead sources & win rate",
    description:
      "Leads created in the period by source. Win rate = won ÷ (won + lost). Use won value against ad spend for ROI.",
    columns: [
      { key: "source", label: "Source" },
      { key: "leads", label: "Leads", type: "number" },
      { key: "quoted", label: "Quoted", type: "number" },
      { key: "won", label: "Won", type: "number" },
      { key: "lost", label: "Lost", type: "number" },
      { key: "winRate", label: "Win rate", type: "percent" },
      { key: "wonValue", label: "Won value inc GST", type: "money" },
    ],
    rows,
    totals: {
      source: "Total",
      leads: sum(rows, "leads"),
      quoted: sum(rows, "quoted"),
      won,
      lost,
      winRate: pct(won, won + lost),
      wonValue: sum(rows, "wonValue"),
    },
  };
}

async function quoteConversion(range: Range): Promise<Report> {
  const quotes = await db.quote.findMany({
    where: { deletedAt: null, createdAt: { gte: range.from, lt: range.to } },
    select: { createdAt: true, status: true, totalCents: true, sentAt: true, acceptedAt: true },
  });
  const months: Date[] = [];
  for (let m = startOfMelbourneMonth(range.from); m < range.to; m = startOfMelbourneMonth(m, 1))
    months.push(m);
  const rows = months
    .map((start, i) => {
      const end = months[i + 1] ?? range.to;
      const q = quotes.filter((x) => x.createdAt >= start && x.createdAt < end);
      const accepted = q.filter((x) => x.status === "ACCEPTED");
      const declined = q.filter((x) => x.status === "DECLINED" || x.status === "EXPIRED").length;
      const days = accepted
        .filter((x) => x.sentAt && x.acceptedAt)
        .map((x) => (x.acceptedAt!.getTime() - x.sentAt!.getTime()) / 86_400_000);
      return {
        month: formatDate(start, "MMM yyyy"),
        created: q.length,
        sent: q.filter((x) => x.status !== "DRAFT").length,
        accepted: accepted.length,
        declined,
        conversion: pct(accepted.length, accepted.length + declined),
        acceptedValue: accepted.reduce((s, x) => s + x.totalCents, 0),
        avgDays: days.length
          ? Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10
          : null,
      };
    })
    .filter((r) => r.created > 0);
  const accepted = sum(rows, "accepted");
  const declined = sum(rows, "declined");
  return {
    id: "quote-conversion",
    title: "Quote conversion",
    description:
      "Quotes created each month and how many were accepted. Conversion = accepted ÷ (accepted + declined/expired).",
    columns: [
      { key: "month", label: "Month" },
      { key: "created", label: "Created", type: "number" },
      { key: "sent", label: "Sent", type: "number" },
      { key: "accepted", label: "Accepted", type: "number" },
      { key: "declined", label: "Declined / expired", type: "number" },
      { key: "conversion", label: "Conversion", type: "percent" },
      { key: "acceptedValue", label: "Accepted value", type: "money" },
      { key: "avgDays", label: "Avg days to accept", type: "number" },
    ],
    rows,
    totals: {
      month: "Total",
      created: sum(rows, "created"),
      sent: sum(rows, "sent"),
      accepted,
      declined,
      conversion: pct(accepted, accepted + declined),
      acceptedValue: sum(rows, "acceptedValue"),
      avgDays: null,
    },
  };
}

/** Aged receivables as at today (ignores the date range). */
async function agedReceivables(): Promise<Report> {
  const now = new Date();
  const invoices = await db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      balanceCents: { gt: 0 },
    },
    include: { client: { select: { name: true, phone: true } } },
    orderBy: { dueDate: "asc" },
  });
  const rows = invoices.map((i) => {
    const bucket = ageBucket(i.dueDate, now);
    return {
      invoice: i.number,
      client: i.client.name,
      phone: i.client.phone,
      dueDate: formatDate(i.dueDate),
      daysOverdue: daysOverdue(i.dueDate, now),
      status: deriveInvoiceStatus(i, now),
      ...Object.fromEntries(AGE_BUCKETS.map((b) => [b, b === bucket ? i.balanceCents : 0])),
      balance: i.balanceCents,
      id: i.id,
    };
  });
  return {
    id: "aged-receivables",
    title: "Aged receivables",
    description: "Unpaid balances as at today, by days past the due date.",
    columns: [
      { key: "invoice", label: "Invoice" },
      { key: "client", label: "Client" },
      { key: "phone", label: "Phone" },
      { key: "dueDate", label: "Due" },
      { key: "daysOverdue", label: "Days overdue", type: "number" },
      { key: "current", label: "Current", type: "money" },
      { key: "1-30", label: "1–30", type: "money" },
      { key: "31-60", label: "31–60", type: "money" },
      { key: "61-90", label: "61–90", type: "money" },
      { key: "90+", label: "90+", type: "money" },
      { key: "balance", label: "Balance", type: "money" },
    ],
    rows,
    totals: {
      invoice: "Total",
      client: `${rows.length} invoices`,
      phone: null,
      dueDate: null,
      daysOverdue: null,
      ...Object.fromEntries(AGE_BUCKETS.map((b) => [b, sum(rows, b)])),
      balance: sum(rows, "balance"),
    },
  };
}

async function jobProfitability(range: Range): Promise<Report> {
  const jobs = await db.job.findMany({
    where: {
      deletedAt: null,
      status: { in: ["COMPLETED", "INVOICED"] },
      actualEnd: { gte: range.from, lt: range.to },
    },
    include: {
      client: { select: { name: true } },
      lineItems: true,
      timeEntries: { include: { user: { select: { hourlyCostCents: true } } } },
      invoices: {
        where: { deletedAt: null, status: { not: "VOID" } },
        select: { subtotalCents: true },
      },
    },
    orderBy: { actualEnd: "desc" },
  });
  const rows = jobs.map((j) => {
    const lineRevenue = j.lineItems.reduce(
      (s, l) => s + lineTotalCents(Number(l.quantity), l.unitPriceCents),
      0,
    );
    const invoiced = j.invoices.reduce((s, i) => s + i.subtotalCents, 0);
    const revenue = invoiced || lineRevenue;
    const materials = j.lineItems
      .filter((l) => l.type !== "LABOUR")
      .reduce((s, l) => s + lineTotalCents(Number(l.quantity), l.unitCostCents), 0);
    const loggedLabour = j.timeEntries.reduce(
      (s, t) => s + Math.round(((t.minutes ?? 0) / 60) * t.user.hourlyCostCents),
      0,
    );
    // Fall back to labour lines' cost when no time was logged.
    const labour =
      loggedLabour ||
      j.lineItems
        .filter((l) => l.type === "LABOUR")
        .reduce((s, l) => s + lineTotalCents(Number(l.quantity), l.unitCostCents), 0);
    const profit = revenue - materials - labour;
    return {
      job: j.number,
      client: j.client.name,
      title: j.title,
      completed: formatDate(j.actualEnd),
      revenue,
      materials,
      labour,
      profit,
      margin: pct(profit, revenue),
      id: j.id,
    };
  });
  const revenue = sum(rows, "revenue");
  const profit = sum(rows, "profit");
  return {
    id: "job-profitability",
    title: "Job profitability",
    description:
      "Completed jobs: revenue ex GST less parts cost and labour (logged hours × hourly cost).",
    columns: [
      { key: "job", label: "Job" },
      { key: "client", label: "Client" },
      { key: "title", label: "Title" },
      { key: "completed", label: "Completed" },
      { key: "revenue", label: "Revenue", type: "money" },
      { key: "materials", label: "Parts", type: "money" },
      { key: "labour", label: "Labour", type: "money" },
      { key: "profit", label: "Profit", type: "money" },
      { key: "margin", label: "Margin", type: "percent" },
    ],
    rows,
    totals: {
      job: "Total",
      client: `${rows.length} jobs`,
      title: null,
      completed: null,
      revenue,
      materials: sum(rows, "materials"),
      labour: sum(rows, "labour"),
      profit,
      margin: pct(profit, revenue),
    },
  };
}

async function topClients(range: Range): Promise<Report> {
  const grouped = await db.payment.groupBy({
    by: ["clientId"],
    where: { paidAt: { gte: range.from, lt: range.to }, invoice: { deletedAt: null } },
    _sum: { amountCents: true },
    _count: true,
    orderBy: { _sum: { amountCents: "desc" } },
    take: 25,
  });
  const clients = await db.client.findMany({
    where: { id: { in: grouped.map((g) => g.clientId) } },
    select: { id: true, name: true, type: true },
  });
  const rows = grouped.map((g) => {
    const c = clients.find((x) => x.id === g.clientId);
    return {
      client: c?.name ?? "Unknown",
      type: c?.type ?? null,
      payments: g._count,
      received: g._sum.amountCents ?? 0,
      id: g.clientId,
    };
  });
  return {
    id: "top-clients",
    title: "Top clients",
    description: "Clients ranked by money received in the period.",
    columns: [
      { key: "client", label: "Client" },
      { key: "type", label: "Type" },
      { key: "payments", label: "Payments", type: "number" },
      { key: "received", label: "Received inc GST", type: "money" },
    ],
    rows,
    totals: {
      client: "Total",
      type: null,
      payments: sum(rows, "payments"),
      received: sum(rows, "received"),
    },
  };
}

/** Plans due in the next 60 days (ignores the date range). */
async function serviceDue(): Promise<Report> {
  const until = addMelbourneDays(new Date(), 60);
  const plans = await db.maintenancePlan.findMany({
    where: {
      active: true,
      nextDueDate: { lte: until },
      client: { deletedAt: null, doNotService: false },
    },
    include: {
      client: { select: { name: true, phone: true, email: true } },
      property: { select: { addressLine1: true, suburb: true } },
    },
    orderBy: { nextDueDate: "asc" },
  });
  const rows = plans.map((p) => ({
    due: formatDate(p.nextDueDate),
    client: p.client.name,
    phone: p.client.phone,
    email: p.client.email,
    site: p.property ? `${p.property.addressLine1}, ${p.property.suburb}` : null,
    plan: p.name,
    price: p.priceCents,
  }));
  return {
    id: "service-due",
    title: "Clients due for service",
    description: "Active maintenance plans due in the next 60 days. Ring-around list.",
    columns: [
      { key: "due", label: "Due" },
      { key: "client", label: "Client" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "site", label: "Site" },
      { key: "plan", label: "Plan" },
      { key: "price", label: "Price ex GST", type: "money" },
    ],
    rows,
    totals: {
      due: "Total",
      client: `${rows.length} plans`,
      phone: null,
      email: null,
      site: null,
      plan: null,
      price: sum(rows, "price"),
    },
  };
}

export async function getReport(id: ReportId, range: Range): Promise<Report> {
  switch (id) {
    case "revenue-by-month":
      return revenueByMonth(range);
    case "revenue-by-category":
      return revenueByCategory(range);
    case "revenue-by-technician":
      return revenueByTechnician(range);
    case "lead-sources":
      return leadSources(range);
    case "quote-conversion":
      return quoteConversion(range);
    case "aged-receivables":
      return agedReceivables();
    case "job-profitability":
      return jobProfitability(range);
    case "top-clients":
      return topClients(range);
    case "service-due":
      return serviceDue();
  }
}

/** Reports whose numbers include costs and margins (admin only). */
export const COST_REPORTS: ReportId[] = ["job-profitability"];

function csvCell(value: string | number | null, type?: ColumnType) {
  if (value === null || value === undefined) return "";
  const text =
    type === "money" && typeof value === "number" ? (value / 100).toFixed(2) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportToCsv(report: Report): string {
  const lines = [report.columns.map((c) => csvCell(c.label)).join(",")];
  for (const row of [...report.rows, ...(report.totals ? [report.totals] : [])]) {
    lines.push(report.columns.map((c) => csvCell(row[c.key] ?? null, c.type)).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
