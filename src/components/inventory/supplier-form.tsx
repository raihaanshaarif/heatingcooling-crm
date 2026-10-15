"use client";

import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import { SwitchField, TextField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { supplierSchema, type SupplierInput } from "@/lib/validations/inventory";
import { saveSupplier } from "@/server/inventory/actions";
import type { SupplierRow } from "@/server/inventory/queries";

export function SupplierForm({
  supplier,
  onDone,
}: {
  supplier?: SupplierRow;
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(supplierSchema, {
    defaultValues: {
      name: supplier?.name ?? "",
      contact: supplier?.contact ?? "",
      phone: supplier?.phone ?? "",
      email: supplier?.email ?? "",
      accountNumber: supplier?.accountNumber ?? "",
      website: supplier?.website ?? "",
      notes: supplier?.notes ?? "",
      active: supplier?.active ?? true,
    },
  });
  const action = useAction((v: SupplierInput) => saveSupplier(supplier?.id ?? null, v), {
    successMessage: supplier ? "Supplier saved" : "Supplier added",
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
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="name" label="Name" className="sm:col-span-2" />
          <TextField name="contact" label="Contact / rep" />
          <TextField name="accountNumber" label="Our account number" />
          <TextField name="phone" label="Phone" type="tel" inputMode="tel" />
          <TextField name="email" label="Email" type="email" />
          <TextField
            name="website"
            label="Website / trade portal"
            className="sm:col-span-2"
            placeholder="https://"
          />
        </div>
        <TextareaField
          name="notes"
          label="Notes"
          rows={2}
          placeholder="Branch, opening hours, delivery days, trade discount…"
        />
        <SwitchField
          name="active"
          label="Active"
          description="Inactive suppliers are hidden when receiving stock."
        />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>
            {supplier ? "Save supplier" : "Add supplier"}
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
