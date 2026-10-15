"use client";

import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import { MoneyField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { formatCents } from "@/lib/money";
import {
  creditNoteSchema,
  voidInvoiceSchema,
  type CreditNoteInput,
} from "@/lib/validations/invoices";
import { createCreditNote, voidInvoice } from "@/server/invoices/actions";
import type { z } from "zod";

export function CreditNoteForm({
  invoiceId,
  maxCents,
  onDone,
}: {
  invoiceId: string;
  maxCents: number;
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(creditNoteSchema, {
    defaultValues: { invoiceId, amount: "", reason: "" },
  });
  const action = useAction((v: CreditNoteInput) => createCreditNote(v), {
    successMessage: (d) => `Credit note ${d.number} issued`,
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
        <MoneyField
          name="amount"
          label="Credit amount (inc GST)"
          description={`Up to ${formatCents(maxCents)}`}
        />
        <TextareaField
          name="reason"
          label="Reason"
          rows={2}
          placeholder="Goodwill discount, part returned…"
        />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Issue credit note</SubmitButton>
        </div>
      </form>
    </Form>
  );
}

export function VoidInvoiceForm({ invoiceId, onDone }: { invoiceId: string; onDone?: () => void }) {
  const router = useRouter();
  const form = useZodForm(voidInvoiceSchema, { defaultValues: { id: invoiceId, reason: "" } });
  const action = useAction((v: z.input<typeof voidInvoiceSchema>) => voidInvoice(v), {
    successMessage: "Invoice voided",
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
        <TextareaField
          name="reason"
          label="Reason"
          rows={2}
          placeholder="Raised in error, replaced by…"
        />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending} variant="destructive">
            Void invoice
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
