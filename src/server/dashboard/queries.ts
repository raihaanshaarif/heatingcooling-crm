import "server-only";
import { db } from "@/lib/db";
import {
  addMelbourneDays,
  formatDate,
  startOfMelbourneDay,
  startOfMelbourneMonth,
  startOfMelbourneWeek,
} from "@/lib/dates";
import { deriveInvoiceStatus } from "@/lib/invoice-status";
import { LEAD_SOURCE_LABELS } from "@/lib/labels";

/** Payments (net of refunds) per Melbourne month for the last `months` months, oldest first. */
export async function revenueByMonth(months = 12, now = new Date()) {
  const starts = Array.from({ length: months }, (_, i) =>
    startOfMelbourneMonth(now, i - (months - 1)),
  );
  const payments = await db.payment.findMany({
    where: { paidAt: { gte: starts[0] }, invoice: { deletedAt: null } },
    select: { paidAt: true, amountCents: true },
  });
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? startOfMelbourneMonth(now, 1);
    const total = payments
      .filter((p) => p.paidAt >= start && p.paidAt < end)
      .reduce((s, p) => s + p.amountCents, 0);
    return { month: formatDate(start, "MMM yy"), revenue: total };
  });
}

export async function getDashboard(now = new Date()) {
  const today = startOfMelbourneDay(now);
  const tomorrow = addMelbourneDays(today, 1);
  const monthStart = startOfMelbourneMonth(now);
  const lastMonthStart = startOfMelbourneMonth(now, -1);
  const weekStart = startOfMelbourneWeek(now);
  const ninetyDaysAgo = addMelbourneDays(today, -90);
  const in30 = addMelbourneDays(today, 30);

  const [
    monthPayments,
    lastMonthPayments,
    openInvoices,
    todaysJobs,
    leadsThisWeek,
    recentLeads,
    openQuotes,
    closedLeads,
    leadsBySource,
    revenue,
    unscheduled,
    plansDue,
    licences,
    warranties,
  ] = await Promise.all([
    db.payment.aggregate({ where: { paidAt: { gte: monthStart } }, _sum: { amountCents: true } }),
    db.payment.aggregate({
      where: { paidAt: { gte: lastMonthStart, lt: monthStart } },
      _sum: { amountCents: true },
    }),
    db.invoice.findMany({
      where: { deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
      include: { client: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
    }),
    db.job.findMany({
      where: {
        deletedAt: null,
        scheduledStart: { gte: today, lt: tomorrow },
        status: { not: "CANCELLED" },
      },
      include: {
        client: { select: { name: true } },
        property: { select: { suburb: true } },
        assignments: { include: { user: { select: { name: true, color: true } } } },
      },
      orderBy: { scheduledStart: "asc" },
    }),
    db.lead.count({ where: { deletedAt: null, createdAt: { gte: weekStart } } }),
    db.lead.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.quote.aggregate({
      where: { deletedAt: null, status: { in: ["SENT", "VIEWED"] } },
      _sum: { totalCents: true },
      _count: true,
    }),
    db.lead.groupBy({
      by: ["status"],
      where: {
        deletedAt: null,
        status: { in: ["WON", "LOST"] },
        updatedAt: { gte: ninetyDaysAgo },
      },
      _count: true,
    }),
    db.lead.groupBy({
      by: ["source"],
      where: { deletedAt: null, createdAt: { gte: ninetyDaysAgo } },
      _count: true,
    }),
    revenueByMonth(12, now),
    db.job.count({ where: { deletedAt: null, status: "UNSCHEDULED" } }),
    db.maintenancePlan.count({ where: { active: true, nextDueDate: { lte: in30 } } }),
    db.technicianLicence.findMany({
      where: { expiresAt: { lte: in30 }, user: { active: true } },
      include: { user: { select: { id: true, name: true } } },
    }),
    db.equipment.count({ where: { warrantyExpiresAt: { gte: today, lte: in30 } } }),
  ]);

  const invoices = openInvoices.map((i) => ({ ...i, status: deriveInvoiceStatus(i, now) }));
  const overdue = invoices.filter((i) => i.status === "OVERDUE");
  const won = closedLeads.find((g) => g.status === "WON")?._count ?? 0;
  const lost = closedLeads.find((g) => g.status === "LOST")?._count ?? 0;

  return {
    revenueThisMonth: monthPayments._sum.amountCents ?? 0,
    revenueLastMonth: lastMonthPayments._sum.amountCents ?? 0,
    outstandingCents: invoices.reduce((s, i) => s + i.balanceCents, 0),
    overdueCents: overdue.reduce((s, i) => s + i.balanceCents, 0),
    overdueInvoices: overdue.slice(0, 6),
    overdueCount: overdue.length,
    todaysJobs,
    leadsThisWeek,
    recentLeads,
    openQuotesCents: openQuotes._sum.totalCents ?? 0,
    openQuotesCount: openQuotes._count,
    winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
    leadsBySource: leadsBySource
      .map((g) => ({ source: LEAD_SOURCE_LABELS[g.source], leads: g._count }))
      .sort((a, b) => b.leads - a.leads),
    revenue,
    unscheduled,
    plansDue,
    licences,
    warranties,
  };
}
