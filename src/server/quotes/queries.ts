import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/utils";

export async function listQuotes() {
  const quotes = await db.quote.findMany({
    where: { deletedAt: null },
    include: {
      client: { select: { id: true, name: true } },
      property: { select: { suburb: true } },
      _count: { select: { options: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return quotes.map((q) => ({
    id: q.id,
    number: q.number,
    title: q.title,
    status: q.status,
    clientId: q.client.id,
    clientName: q.client.name,
    suburb: q.property?.suburb ?? null,
    optionCount: q._count.options,
    totalCents: q.totalCents,
    validUntil: q.validUntil,
    sentAt: q.sentAt,
    createdAt: q.createdAt,
  }));
}
export type QuoteRow = Awaited<ReturnType<typeof listQuotes>>[number];

const quoteInclude = {
  client: true,
  property: true,
  lead: { select: { id: true, leadNumber: true, name: true } },
  options: {
    orderBy: { sortOrder: "asc" as const },
    include: { lineItems: { orderBy: { sortOrder: "asc" as const } } },
  },
  jobs: { where: { deletedAt: null }, select: { id: true, number: true, status: true } },
} satisfies Prisma.QuoteInclude;

type QuoteWithRelations = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;

function serialise(quote: QuoteWithRelations) {
  return {
    ...quote,
    options: quote.options.map((o) => ({
      ...o,
      lineItems: o.lineItems.map((l) => ({ ...l, quantity: toNumber(l.quantity) ?? 0 })),
    })),
  };
}

export async function getQuote(id: string) {
  const quote = await db.quote.findFirst({ where: { id, deletedAt: null }, include: quoteInclude });
  return quote ? serialise(quote) : null;
}
export type QuoteDetail = NonNullable<Awaited<ReturnType<typeof getQuote>>>;

export async function getQuoteByToken(token: string) {
  const quote = await db.quote.findFirst({
    where: { publicToken: token, deletedAt: null },
    include: quoteInclude,
  });
  return quote ? serialise(quote) : null;
}
