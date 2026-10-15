import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getClientOptions } from "@/server/clients/queries";
import { getPriceBookPicker } from "@/server/price-book/queries";
import { getQuote } from "@/server/quotes/queries";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/shared/page-header";
import { QuoteBuilder } from "@/components/quotes/quote-builder";

export const metadata: Metadata = { title: "Edit quote" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("update", "quotes");
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) notFound();
  if (quote.status === "ACCEPTED" || quote.status === "DECLINED") redirect(`/quotes/${id}`);
  const [clients, priceBook, settings] = await Promise.all([
    getClientOptions(),
    getPriceBookPicker({ includeCosts: can(user, "view", "priceBookCosts") }),
    getSettings(),
  ]);
  return (
    <>
      <PageHeader
        back={{ href: `/quotes/${id}`, label: quote.number }}
        title={`Edit ${quote.number}`}
      />
      <QuoteBuilder
        quote={quote}
        clients={clients}
        priceBook={priceBook}
        gstRegistered={settings.gstRegistered}
        defaults={{ terms: settings.quoteTerms ?? "", validityDays: settings.quoteValidityDays }}
      />
    </>
  );
}
