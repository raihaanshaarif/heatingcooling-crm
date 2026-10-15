"use client";

import { useRouter } from "next/navigation";
import { useZodForm } from "@/components/forms/use-zod-form";
import type { Equipment } from "@prisma/client";
import { Form } from "@/components/ui/form";
import { CheckboxField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { BRANDS, EQUIPMENT_TYPE_LABELS, REFRIGERANTS, options } from "@/lib/labels";
import { toDateInput } from "@/lib/dates";
import { equipmentSchema, type EquipmentInput } from "@/lib/validations/clients";
import { saveEquipment } from "@/server/equipment/actions";

export type EquipmentFormValue = Omit<Equipment, "capacityKw"> & { capacityKw: number | null };

export function EquipmentForm({
  propertyId,
  propertyOptions,
  equipment,
  onDone,
}: {
  propertyId?: string;
  propertyOptions?: { value: string; label: string }[];
  equipment?: EquipmentFormValue;
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(equipmentSchema, {
    defaultValues: {
      propertyId: equipment?.propertyId ?? propertyId ?? "",
      type: equipment?.type ?? "SPLIT_SYSTEM",
      brand: equipment?.brand ?? "",
      model: equipment?.model ?? "",
      serialNumber: equipment?.serialNumber ?? "",
      indoorModel: equipment?.indoorModel ?? "",
      outdoorModel: equipment?.outdoorModel ?? "",
      capacityKw: equipment?.capacityKw?.toString() ?? "",
      refrigerant: equipment?.refrigerant ?? "",
      location: equipment?.location ?? "",
      installDate: toDateInput(equipment?.installDate),
      installedByUs: equipment?.installedByUs ?? false,
      warrantyExpiresAt: toDateInput(equipment?.warrantyExpiresAt),
      notes: equipment?.notes ?? "",
    },
  });
  const action = useAction((v: EquipmentInput) => saveEquipment(equipment?.id ?? null, v), {
    successMessage: equipment ? "Equipment updated" : "Equipment added",
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
          {propertyOptions && (
            <SelectField
              name="propertyId"
              label="Property"
              options={propertyOptions}
              className="sm:col-span-2"
            />
          )}
          <SelectField name="type" label="Type" options={options(EQUIPMENT_TYPE_LABELS)} />
          <SelectField
            name="brand"
            label="Brand"
            options={BRANDS.map((b) => ({ value: b, label: b }))}
          />
          <TextField name="model" label="Model" />
          <TextField name="serialNumber" label="Serial number" />
          <TextField name="indoorModel" label="Indoor unit model" />
          <TextField name="outdoorModel" label="Outdoor unit model" />
          <TextField name="capacityKw" label="Capacity (kW)" inputMode="decimal" />
          <SelectField
            name="refrigerant"
            label="Refrigerant"
            options={REFRIGERANTS.map((r) => ({ value: r, label: r }))}
            allowEmpty
            emptyLabel="N/A"
          />
          <TextField name="location" label="Location" placeholder="Master bedroom, roof space…" />
          <TextField name="installDate" label="Install date" type="date" />
          <TextField name="warrantyExpiresAt" label="Warranty expires" type="date" />
          <CheckboxField name="installedByUs" label="Installed by us" className="self-end pb-2" />
        </div>
        <TextareaField name="notes" label="Notes" rows={2} />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>
            {equipment ? "Save equipment" : "Add equipment"}
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
