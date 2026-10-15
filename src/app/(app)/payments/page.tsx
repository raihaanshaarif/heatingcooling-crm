import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { parseDateRange } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { listPayments } from "@/server/payments/queries";
import { getOpenInvoiceOptions } from "@/server/invoices/queries";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { NewRecordDialog } from "@/components/shared/new-record-dialog";
import { PaymentForm } from "@/components/invoices/payment-form";
import { PaymentsTable } from "@/components/invoices/payments-table";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePermission("view", "payments");
  const range = parseDateRange(await searchParams);
  const [payments, openInvoices] = await Promise.all([
    listPayments(range),
    can(user, "create", "payments") ? getOpenInvoiceOptions() : [],
  ]);
  const received = payments.filter((p) => p.amountCents > 0).reduce((s, p) => s + p.amountCents, 0);
  const refunded = payments.filter((p) => p.amountCents < 0).reduce((s, p) => s + p.amountCents, 0);
  const byMethod = Object.entries(
    payments.reduce<Record<string, number>>(
      (acc, p) => ({ ...acc, [p.method]: (acc[p.method] ?? 0) + p.amountCents }),
      {},
    ),
  ).sort((a, b) => b[1] - a[1])[0];
  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received against invoices."
        actions={
          can(user, "create", "payments") && (
            <NewRecordDialog label="Record payment" title="Record payment">
              <PaymentForm invoices={openInvoices} />
            </NewRecordDialog>
          )
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Received"
          value={formatCents(received)}
          hint={`${payments.filter((p) => p.amountCents > 0).length} payments`}
          tone="success"
        />
        <StatCard label="Refunded" value={formatCents(-refunded)} />
        <StatCard
          label="Top method"
          value={
            byMethod
              ? PAYMENT_METHOD_LABELS[byMethod[0] as keyof typeof PAYMENT_METHOD_LABELS]
              : "–"
          }
          hint={byMethod ? formatCents(byMethod[1]) : undefined}
        />
      </div>
      <PaymentsTable data={payments} />
    </>
  );
}
