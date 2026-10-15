"use client";

import { useRouter } from "next/navigation";
import { useZodForm } from "@/components/forms/use-zod-form";
import type { Property } from "@prisma/client";
import { Form } from "@/components/ui/form";
import { SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { AU_STATES } from "@/lib/validations/common";
import { propertySchema, type PropertyInput } from "@/lib/validations/clients";
import { saveProperty } from "@/server/clients/actions";

export function PropertyForm({
  clientId,
  property,
  onDone,
}: {
  clientId: string;
  property?: Property;
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(propertySchema, {
    defaultValues: {
      clientId,
      label: property?.label ?? "",
      addressLine1: property?.addressLine1 ?? "",
      addressLine2: property?.addressLine2 ?? "",
      suburb: property?.suburb ?? "",
      state: (property?.state as PropertyInput["state"]) ?? "VIC",
      postcode: property?.postcode ?? "",
      accessNotes: property?.accessNotes ?? "",
      parkingNotes: property?.parkingNotes ?? "",
      petNotes: property?.petNotes ?? "",
      keyInfo: property?.keyInfo ?? "",
    },
  });
  const action = useAction((v: PropertyInput) => saveProperty(property?.id ?? null, v), {
    successMessage: property ? "Property updated" : "Property added",
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
        <div className="grid gap-4 sm:grid-cols-6">
          <TextField
            name="label"
            label="Label"
            placeholder="e.g. Home, Rental – Unit 3, Head office"
            className="sm:col-span-6"
          />
          <TextField name="addressLine1" label="Street address" className="sm:col-span-6" />
          <TextField
            name="addressLine2"
            label="Unit / building (optional)"
            className="sm:col-span-6"
          />
          <TextField name="suburb" label="Suburb" className="sm:col-span-3" />
          <SelectField
            name="state"
            label="State"
            className="sm:col-span-1"
            options={AU_STATES.map((s) => ({ value: s, label: s }))}
          />
          <TextField
            name="postcode"
            label="Postcode"
            className="sm:col-span-2"
            inputMode="numeric"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextareaField
            name="accessNotes"
            label="Access notes"
            rows={2}
            placeholder="Side gate, roof access via manhole in laundry…"
          />
          <TextareaField name="parkingNotes" label="Parking" rows={2} />
          <TextareaField name="petNotes" label="Pets" rows={2} />
          <TextareaField name="keyInfo" label="Keys / lockbox" rows={2} />
        </div>
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>
            {property ? "Save property" : "Add property"}
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
