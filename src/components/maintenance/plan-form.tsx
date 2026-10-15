"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import {
  CheckboxGroupField,
  MoneyField,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { PLAN_FREQUENCY_LABELS, options } from "@/lib/labels";
import { addMelbourneMonths, toDateInput } from "@/lib/dates";
import { maintenancePlanSchema, type MaintenancePlanInput } from "@/lib/validations/maintenance";
import { saveMaintenancePlan } from "@/server/maintenance/actions";
import { getPropertyEquipmentOptions } from "@/server/jobs/actions";
import type { ClientOption } from "@/server/clients/queries";
import type { PlanRow } from "@/server/maintenance/queries";

export function PlanForm({
  plan,
  clients,
  onDone,
}: {
  plan?: PlanRow;
  clients: ClientOption[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const today = new Date();
  const form = useZodForm(maintenancePlanSchema, {
    defaultValues: {
      clientId: plan?.clientId ?? "",
      propertyId: plan?.propertyId ?? null,
      name: plan?.name ?? "Annual service",
      frequency: plan?.frequency ?? "YEARLY",
      price: plan ? (plan.priceCents / 100).toFixed(2) : "",
      startDate: toDateInput(plan?.startDate ?? today),
      nextDueDate: toDateInput(plan?.nextDueDate ?? addMelbourneMonths(today, 12)),
      active: plan?.active ?? true,
      notes: plan?.notes ?? "",
      equipmentIds: plan?.equipmentIds ?? [],
    },
  });
  const clientId = form.watch("clientId");
  const propertyId = form.watch("propertyId");
  const client = clients.find((c) => c.id === clientId);
  const [equipment, setEquipment] = useState<{ value: string; label: string; hint?: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!propertyId) {
      setEquipment([]);
      return;
    }
    void getPropertyEquipmentOptions({ id: propertyId }).then(
      (r) => !cancelled && r.ok && setEquipment(r.data),
    );
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const action = useAction((v: MaintenancePlanInput) => saveMaintenancePlan(plan?.id ?? null, v), {
    successMessage: plan ? "Plan saved" : "Plan created",
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
          <SelectField
            name="clientId"
            label="Client"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Choose a client"
            onValueChange={(id) => {
              form.setValue(
                "propertyId",
                clients.find((c) => c.id === id)?.properties[0]?.id ?? null,
              );
              form.setValue("equipmentIds", []);
            }}
          />
          <SelectField
            name="propertyId"
            label="Site"
            options={(client?.properties ?? []).map((p) => ({ value: p.id, label: p.label }))}
            allowEmpty
            emptyLabel="No site"
            onValueChange={() => form.setValue("equipmentIds", [])}
          />
          <TextField name="name" label="Plan name" />
          <SelectField
            name="frequency"
            label="Frequency"
            options={options(PLAN_FREQUENCY_LABELS)}
          />
          <MoneyField name="price" label="Price per visit (ex GST)" />
          <TextField name="startDate" label="Start date" type="date" />
          <TextField name="nextDueDate" label="Next service due" type="date" />
        </div>
        {propertyId && (
          <CheckboxGroupField
            name="equipmentIds"
            label="Equipment covered"
            options={equipment}
            emptyText="No equipment recorded at this site."
          />
        )}
        <TextareaField
          name="notes"
          label="Notes"
          rows={2}
          placeholder="Filters to bring, access, what's included…"
        />
        <SwitchField
          name="active"
          label="Active"
          description="Inactive plans don't send reminders."
        />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>{plan ? "Save plan" : "Create plan"}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
