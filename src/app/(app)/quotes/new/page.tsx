import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { SERVICE_CATEGORY_LABELS } from "@/lib/labels";
import { getClientOptions } from "@/server/clients/queries";
import { getPriceBookPicker } from "@/server/price-book/queries";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/shared/page-header";
import { QuoteBuilder } from "@/components/quotes/quote-builder";

export const metadata: Metadata = { title: "New quote" };

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; propertyId?: string; leadId?: string }>;
}) {
  const user = await requirePermission("create", "quotes");
  const params = await searchParams;
  const [clients, priceBook, settings, lead] = await Promise.all([
    getClientOptions(),
    getPriceBookPicker({ includeCosts: can(user, "view", "priceBookCosts") }),
    getSettings(),
    params.leadId ? db.lead.findUnique({ where: { id: params.leadId } }) : null,
  ]);
  const client = clients.find((c) => c.id === params.clientId);
  return (
    <>
      <PageHeader back={{ href: "/quotes", label: "Quotes" }} title="New quote" />
      <QuoteBuilder
        clients={clients}
        priceBook={priceBook}
        gstRegistered={settings.gstRegistered}
        defaults={{
          clientId: client?.id,
          propertyId: params.propertyId ?? client?.properties[0]?.id,
          leadId: lead?.id,
          title: lead?.serviceCategory
            ? `${SERVICE_CATEGORY_LABELS[lead.serviceCategory]}${lead.brand ? ` – ${lead.brand}` : ""}`
            : undefined,
          terms: settings.quoteTerms ?? "",
          validityDays: settings.quoteValidityDays,
        }}
      />
    </>
  );
}
