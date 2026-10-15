"use client";

import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import {
  CheckboxField,
  MoneyField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { PAYMENT_METHOD_LABELS, options } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { toDateInput } from "@/lib/dates";
import { paymentSchema, type PaymentInput } from "@/lib/validations/invoices";
import { recordPayment } from "@/server/payments/actions";

export function PaymentForm({
  invoiceId,
  balanceCents,
  invoices,
  allowRefund,
  onDone,
}: {
  invoiceId?: string;
  balanceCents?: number;
  /** Shown when no invoice is fixed (Payments page). */
  invoices?: { value: string; label: string; balanceCents: number }[];
  allowRefund?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(paymentSchema, {
    defaultValues: {
      invoiceId: invoiceId ?? "",
      amount: balanceCents && balanceCents > 0 ? (balanceCents / 100).toFixed(2) : "",
      method: "BANK_TRANSFER",
      reference: "",
      paidAt: toDateInput(new Date()),
      notes: "",
      isRefund: false,
    },
  });
  const action = useAction((v: PaymentInput) => recordPayment(v), {
    successMessage: (d) => (d ? "Payment recorded" : "Saved"),
    onSuccess: () => {
      onDone?.();
      router.refresh();
    },
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        {!invoiceId && invoices && (
          <SelectField
            name="invoiceId"
            label="Invoice"
            options={invoices.map((i) => ({
              value: i.value,
              label: `${i.label} · ${formatCents(i.balanceCents)} due`,
            }))}
            placeholder="Choose an open invoice"
            onValueChange={(id) => {
              const inv = invoices.find((i) => i.value === id);
              if (inv) form.setValue("amount", (inv.balanceCents / 100).toFixed(2));
            }}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField name="amount" label="Amount (inc GST)" />
          <TextField name="paidAt" label="Date received" type="date" />
          <SelectField name="method" label="Method" options={options(PAYMENT_METHOD_LABELS)} />
          <TextField name="reference" label="Reference" placeholder="Bank ref, receipt no…" />
        </div>
        <TextareaField name="notes" label="Notes" rows={2} />
        {allowRefund && <CheckboxField name="isRefund" label="This is a refund to the client" />}
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Record payment</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
