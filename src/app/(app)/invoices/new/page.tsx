import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getClientOptions } from "@/server/clients/queries";
import { getPriceBookPicker } from "@/server/price-book/queries";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/shared/page-header";
import { InvoiceForm } from "@/components/invoices/invoice-form";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const user = await requirePermission("create", "invoices");
  const { clientId } = await searchParams;
  const withCost = can(user, "view", "priceBookCosts");
  const [clients, priceBook, settings] = await Promise.all([
    getClientOptions(),
    getPriceBookPicker({ includeCosts: withCost }),
    getSettings(),
  ]);
  const client = clients.find((c) => c.id === clientId);
  return (
    <>
      <PageHeader
        back={{ href: "/invoices", label: "Invoices" }}
        title="New invoice"
        description="To invoice a job, open the job and use Create invoice."
      />
      <InvoiceForm
        clients={clients}
        priceBook={priceBook}
        gstRegistered={settings.gstRegistered}
        withCost={withCost}
        defaults={{
          clientId: client?.id,
          propertyId: client?.properties[0]?.id,
          paymentTerms: settings.defaultPaymentTerms,
        }}
      />
    </>
  );
}
