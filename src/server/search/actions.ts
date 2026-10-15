"use server";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { normalisePhone } from "@/lib/utils";

export interface SearchResult {
  id: string;
  type: "client" | "lead" | "job" | "quote" | "invoice";
  title: string;
  subtitle: string;
  href: string;
}

/** Global search for the command palette: clients, leads, jobs, quotes and invoices by name, number, phone or email. */
export async function globalSearch(query: string): Promise<SearchResult[]> {
  const user = await getCurrentUser();
  const q = query.trim();
  if (!user || q.length < 2) return [];
  const contains = { contains: q, mode: "insensitive" as const };
  const phoneDigits = normalisePhone(q);
  const phoneFilter =
    phoneDigits && phoneDigits.length >= 4 ? [{ phone: { contains: phoneDigits.slice(-4) } }] : [];
  const results: SearchResult[] = [];

  if (can(user, "view", "clients")) {
    const clients = await db.client.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: contains },
          { companyName: contains },
          { email: contains },
          { phone: contains },
          ...phoneFilter,
        ],
      },
      take: 6,
      orderBy: { updatedAt: "desc" },
    });
    results.push(
      ...clients.map((c) => ({
        id: c.id,
        type: "client" as const,
        title: c.companyName ? `${c.name} (${c.companyName})` : c.name,
        subtitle: [c.phone, c.email].filter(Boolean).join(" · "),
        href: `/clients/${c.id}`,
      })),
    );
  }
  if (can(user, "view", "leads")) {
    const leadNumber = Number(q.replace(/^L-?/i, ""));
    const leads = await db.lead.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: contains },
          { email: contains },
          { phone: contains },
          { suburb: contains },
          ...phoneFilter,
          ...(Number.isInteger(leadNumber) && leadNumber > 0 ? [{ leadNumber }] : []),
        ],
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    });
    results.push(
      ...leads.map((l) => ({
        id: l.id,
        type: "lead" as const,
        title: `L-${l.leadNumber} ${l.name}`,
        subtitle: [l.suburb, l.phone, l.email].filter(Boolean).join(" · "),
        href: `/leads/${l.id}`,
      })),
    );
  }
  if (can(user, "view", "schedule") || can(user, "view", "myJobs")) {
    const jobs = await db.job.findMany({
      where: {
        deletedAt: null,
        ...(user.role === "TECHNICIAN" ? { assignments: { some: { userId: user.id } } } : {}),
        OR: [{ number: contains }, { title: contains }, { client: { name: contains } }],
      },
      include: { client: { select: { name: true } } },
      take: 5,
      orderBy: { createdAt: "desc" },
    });
    results.push(
      ...jobs.map((j) => ({
        id: j.id,
        type: "job" as const,
        title: `${j.number} ${j.title}`,
        subtitle: j.client.name,
        href: user.role === "TECHNICIAN" ? `/my-jobs/${j.id}` : `/jobs/${j.id}`,
      })),
    );
  }
  if (can(user, "view", "quotes")) {
    const quotes = await db.quote.findMany({
      where: {
        deletedAt: null,
        OR: [{ number: contains }, { title: contains }, { client: { name: contains } }],
      },
      include: { client: { select: { name: true } } },
      take: 5,
      orderBy: { createdAt: "desc" },
    });
    results.push(
      ...quotes.map((x) => ({
        id: x.id,
        type: "quote" as const,
        title: `${x.number} ${x.title}`,
        subtitle: x.client.name,
        href: `/quotes/${x.id}`,
      })),
    );
  }
  if (can(user, "view", "invoices")) {
    const invoices = await db.invoice.findMany({
      where: {
        deletedAt: null,
        OR: [{ number: contains }, { client: { name: contains } }, { client: { email: contains } }],
      },
      include: { client: { select: { name: true } } },
      take: 5,
      orderBy: { createdAt: "desc" },
    });
    results.push(
      ...invoices.map((i) => ({
        id: i.id,
        type: "invoice" as const,
        title: i.number,
        subtitle: i.client.name,
        href: `/invoices/${i.id}`,
      })),
    );
  }
  return results;
}
