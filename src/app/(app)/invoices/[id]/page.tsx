import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS, PAYMENT_TERMS_LABELS } from "@/lib/labels";
import { daysOverdue } from "@/lib/invoice-status";
import { appUrl, formatAddress } from "@/lib/utils";
import { getInvoice } from "@/server/invoices/queries";
import { getSettings } from "@/server/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { DetailList } from "@/components/shared/detail-list";
import { InvoiceStatusBadge } from "@/components/shared/status-badge";
import { NoteForm, Timeline } from "@/components/shared/timeline";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { DeletePaymentButton } from "@/components/invoices/delete-payment-button";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("view", "invoices");
  const { id } = await params;
  const [invoice, settings] = await Promise.all([getInvoice(id), getSettings()]);
  if (!invoice) notFound();
  const showCosts = can(user, "view", "priceBookCosts");
  const cost = invoice.lineItems.reduce((s, l) => s + Math.round(l.quantity * l.unitCostCents), 0);
  const overdueDays = invoice.status === "OVERDUE" ? daysOverdue(invoice.dueDate) : 0;
  return (
    <>
      <PageHeader
        back={{ href: "/invoices", label: "Invoices" }}
        title={invoice.number}
        badge={<InvoiceStatusBadge status={invoice.status} />}
        description={
          <>
            {invoice.client.name} · {formatCents(invoice.totalCents)} inc GST
            {overdueDays > 0 && (
              <span className="text-destructive"> · {overdueDays} days overdue</span>
            )}
          </>
        }
        actions={
          <InvoiceActions
            invoice={{
              id: invoice.id,
              number: invoice.number,
              status: invoice.status,
              hasEmail: !!invoice.client.email,
              balanceCents: invoice.balanceCents,
              amountPaidCents: invoice.amountPaidCents,
              creditableCents: invoice.totalCents - invoice.creditedCents,
            }}
            publicUrl={appUrl(`/i/${invoice.publicToken}`)}
            canEdit={can(user, "update", "invoices")}
            canDelete={can(user, "delete", "invoices")}
            canPay={can(user, "create", "payments")}
          />
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{settings.gstRegistered ? "Tax invoice" : "Invoice"}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit ex GST</TableHead>
                    {showCosts && <TableHead className="text-right">Unit cost</TableHead>}
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lineItems.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-normal">
                        {l.description}
                        {!l.taxable && settings.gstRegistered && (
                          <span className="text-muted-foreground text-xs"> (GST free)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(l.unitPriceCents)}
                      </TableCell>
                      {showCosts && (
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {formatCents(l.unitCostCents)}
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums">
                        {formatCents(l.totalCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  {[
                    { label: "Subtotal", value: invoice.subtotalCents },
                    ...(settings.gstRegistered ? [{ label: "GST", value: invoice.gstCents }] : []),
                    { label: "Total", value: invoice.totalCents, bold: true },
                    ...(invoice.amountPaidCents
                      ? [{ label: "Paid", value: -invoice.amountPaidCents }]
                      : []),
                    ...(invoice.creditedCents
                      ? [{ label: "Credited", value: -invoice.creditedCents }]
                      : []),
                    {
                      label: "Balance due",
                      value: invoice.status === "VOID" ? 0 : invoice.balanceCents,
                      bold: true,
                    },
                  ].map((r) => (
                    <TableRow key={r.label}>
                      <TableCell
                        colSpan={showCosts ? 4 : 3}
                        className={r.bold ? "text-right font-semibold" : "text-right"}
                      >
                        {r.label}
                      </TableCell>
                      <TableCell
                        className={
                          r.bold
                            ? "text-right font-semibold tabular-nums"
                            : "text-right tabular-nums"
                        }
                      >
                        {formatCents(r.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {showCosts && cost > 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground text-right">
                        Gross profit (ex GST)
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {formatCents(invoice.subtotalCents - cost)}
                      </TableCell>
                    </TableRow>
                  )}
                </TableFooter>
              </Table>
              {invoice.notes && (
                <p className="text-muted-foreground mt-4 text-sm whitespace-pre-line">
                  {invoice.notes}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {invoice.payments.length === 0 && invoice.creditNotes.length === 0 ? (
                <p className="text-muted-foreground text-sm">No payments yet.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {invoice.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                      <div>
                        <p className="font-medium">
                          {p.amountCents < 0 ? "Refund" : "Payment"} ·{" "}
                          {PAYMENT_METHOD_LABELS[p.method]}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatDate(p.paidAt)}
                          {p.reference && ` · Ref ${p.reference}`}
                          {p.recordedBy && ` · by ${p.recordedBy.name}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="tabular-nums">{formatCents(p.amountCents)}</span>
                        {can(user, "delete", "payments") && <DeletePaymentButton id={p.id} />}
                      </div>
                    </li>
                  ))}
                  {invoice.creditNotes.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                      <div>
                        <p className="font-medium">Credit note {c.number}</p>
                        <p className="text-muted-foreground text-xs">
                          {formatDate(c.issuedAt)} · {c.reason}
                        </p>
                      </div>
                      <span className="tabular-nums">{formatCents(-c.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {can(user, "update", "invoices") && (
                <NoteForm entityType="INVOICE" entityId={invoice.id} />
              )}
              <Timeline items={invoice.timeline} />
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                {
                  label: "Client",
                  value: (
                    <Link className="hover:underline" href={`/clients/${invoice.clientId}`}>
                      {invoice.client.name}
                    </Link>
                  ),
                },
                { label: "Email", value: invoice.client.email },
                { label: "Site", value: invoice.property ? formatAddress(invoice.property) : null },
                {
                  label: "Job",
                  value: invoice.job && (
                    <Link className="hover:underline" href={`/jobs/${invoice.job.id}`}>
                      {invoice.job.number}
                    </Link>
                  ),
                },
                { label: "Issued", value: formatDate(invoice.issueDate) },
                { label: "Terms", value: PAYMENT_TERMS_LABELS[invoice.paymentTerms] },
                { label: "Due", value: formatDate(invoice.dueDate) },
                { label: "Sent", value: invoice.sentAt ? formatDateTime(invoice.sentAt) : null },
                { label: "Paid", value: invoice.paidAt ? formatDate(invoice.paidAt) : null },
                { label: "Voided", value: invoice.voidedAt ? formatDate(invoice.voidedAt) : null },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
