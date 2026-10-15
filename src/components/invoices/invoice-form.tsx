"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { EMPTY_LINE, LineItemsEditor } from "@/components/line-items/line-items-editor";
import { PAYMENT_TERMS_LABELS, options } from "@/lib/labels";
import { toDateInput } from "@/lib/dates";
import { dueDateFromTerms } from "@/lib/invoice-status";
import { invoiceSchema, type InvoiceInput } from "@/lib/validations/invoices";
import { createInvoice, updateInvoice } from "@/server/invoices/actions";
import type { ClientOption } from "@/server/clients/queries";
import type { InvoiceDetail } from "@/server/invoices/queries";
import type { PriceBookPickerItem } from "@/server/price-book/queries";
import type { PaymentTerms } from "@prisma/client";

export function InvoiceForm({
  invoice,
  clients,
  priceBook,
  gstRegistered,
  withCost,
  defaults,
}: {
  invoice?: InvoiceDetail;
  clients: ClientOption[];
  priceBook: PriceBookPickerItem[];
  gstRegistered: boolean;
  withCost: boolean;
  defaults: { clientId?: string; propertyId?: string; paymentTerms: PaymentTerms };
}) {
  const router = useRouter();
  const form = useZodForm(invoiceSchema, {
    defaultValues: {
      clientId: invoice?.clientId ?? defaults.clientId ?? "",
      propertyId: invoice?.propertyId ?? defaults.propertyId ?? null,
      jobId: invoice?.jobId ?? null,
      issueDate: toDateInput(invoice?.issueDate ?? new Date()),
      paymentTerms: invoice?.paymentTerms ?? defaults.paymentTerms,
      dueDate: invoice ? toDateInput(invoice.dueDate) : "",
      notes: invoice?.notes ?? "",
      lines: invoice
        ? invoice.lineItems.map((l) => ({
            description: l.description,
            quantity: String(l.quantity),
            unitPrice: (l.unitPriceCents / 100).toFixed(2),
            unitCost: (l.unitCostCents / 100).toFixed(2),
            taxable: l.taxable,
          }))
        : [{ ...EMPTY_LINE }],
    },
  });
  const clientId = form.watch("clientId");
  const issueDate = form.watch("issueDate");
  const terms = form.watch("paymentTerms");
  const client = clients.find((c) => c.id === clientId);
  const computedDue = issueDate
    ? toDateInput(dueDateFromTerms(new Date(`${issueDate}T00:00:00`), terms))
    : "";

  const action = useAction(
    (v: InvoiceInput) => (invoice ? updateInvoice(invoice.id, v) : createInvoice(v)),
    {
      successMessage: invoice ? "Invoice saved" : "Invoice created",
      onSuccess: (d) => router.push(`/invoices/${d.id}`),
    },
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              name="clientId"
              label="Client"
              className="sm:col-span-2"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Choose a client"
              onValueChange={(id) =>
                form.setValue(
                  "propertyId",
                  clients.find((c) => c.id === id)?.properties[0]?.id ?? null,
                )
              }
            />
            <SelectField
              name="propertyId"
              label="Site"
              className="sm:col-span-2"
              options={(client?.properties ?? []).map((p) => ({ value: p.id, label: p.label }))}
              allowEmpty
              emptyLabel="No site"
            />
            <TextField name="issueDate" label="Issue date" type="date" />
            <SelectField
              name="paymentTerms"
              label="Payment terms"
              options={options(PAYMENT_TERMS_LABELS)}
            />
            <TextField
              name="dueDate"
              label="Due date"
              type="date"
              description={
                computedDue
                  ? `Leave blank for ${computedDue.split("-").reverse().join("/")}`
                  : undefined
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Line items</CardTitle>
          </CardHeader>
          <CardContent>
            <LineItemsEditor
              name="lines"
              priceBook={priceBook}
              gstRegistered={gstRegistered}
              withCost={withCost}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <TextareaField name="notes" label="Notes on the invoice" rows={3} />
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>
            {invoice ? "Save invoice" : "Create invoice"}
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
