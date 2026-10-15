import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getClientOptions } from "@/server/clients/queries";
import { getInvoice } from "@/server/invoices/queries";
import { getPriceBookPicker } from "@/server/price-book/queries";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/shared/page-header";
import { InvoiceForm } from "@/components/invoices/invoice-form";

export const metadata: Metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("update", "invoices");
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  if (invoice.status === "VOID" || invoice.amountPaidCents !== 0 || invoice.creditedCents !== 0)
    redirect(`/invoices/${id}`);
  const withCost = can(user, "view", "priceBookCosts");
  const [clients, priceBook, settings] = await Promise.all([
    getClientOptions(),
    getPriceBookPicker({ includeCosts: withCost }),
    getSettings(),
  ]);
  return (
    <>
      <PageHeader
        back={{ href: `/invoices/${id}`, label: invoice.number }}
        title={`Edit ${invoice.number}`}
      />
      <InvoiceForm
        invoice={invoice}
        clients={clients}
        priceBook={priceBook}
        gstRegistered={settings.gstRegistered}
        withCost={withCost}
        defaults={{ paymentTerms: settings.defaultPaymentTerms }}
      />
    </>
  );
}
