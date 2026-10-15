"use client";

import { useRouter } from "next/navigation";
import type { Lead } from "@prisma/client";
import { Form } from "@/components/ui/form";
import { MoneyField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import {
  BRANDS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  PRIORITY_LABELS,
  SERVICE_CATEGORY_LABELS,
  options,
} from "@/lib/labels";
import { toDateInput } from "@/lib/dates";
import { leadSchema, type LeadInput } from "@/lib/validations/leads";
import { createLead, updateLead } from "@/server/leads/actions";

export function LeadForm({
  lead,
  staff,
  onDone,
}: {
  lead?: Lead;
  staff: { value: string; label: string }[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(leadSchema, {
    defaultValues: {
      name: lead?.name ?? "",
      email: lead?.email ?? "",
      phone: lead?.phone ?? "",
      suburb: lead?.suburb ?? "",
      postcode: lead?.postcode ?? "",
      status: lead?.status ?? "NEW",
      source: lead?.source ?? "PHONE",
      sourceDetail: lead?.sourceDetail ?? "",
      serviceCategory: lead?.serviceCategory ?? null,
      brand: lead?.brand ?? "",
      message: lead?.message ?? "",
      urgency: lead?.urgency ?? "NORMAL",
      estimatedValue:
        lead?.estimatedValueCents != null ? (lead.estimatedValueCents / 100).toFixed(2) : "",
      assignedToId: lead?.assignedToId ?? null,
      followUpAt: toDateInput(lead?.followUpAt),
    },
  });
  const action = useAction((v: LeadInput) => (lead ? updateLead(lead.id, v) : createLead(v)), {
    successMessage: lead ? "Lead updated" : "Lead created",
    onSuccess: (d) => {
      onDone?.();
      if (lead) router.refresh();
      else router.push(`/leads/${d.id}`);
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
          <TextField name="name" label="Name" autoComplete="off" />
          <TextField name="phone" label="Phone" type="tel" />
          <TextField name="email" label="Email" type="email" />
          <div className="grid grid-cols-3 gap-2">
            <TextField name="suburb" label="Suburb" className="col-span-2" />
            <TextField name="postcode" label="Postcode" inputMode="numeric" />
          </div>
          <SelectField name="source" label="Source" options={options(LEAD_SOURCE_LABELS)} />
          <TextField
            name="sourceDetail"
            label="Source detail"
            placeholder="Campaign, referrer name…"
          />
          <SelectField
            name="serviceCategory"
            label="Service"
            options={options(SERVICE_CATEGORY_LABELS)}
            allowEmpty
            emptyLabel="Not sure yet"
          />
          <SelectField
            name="brand"
            label="Brand"
            options={BRANDS.map((b) => ({ value: b, label: b }))}
            allowEmpty
            emptyLabel="Unknown"
          />
          <SelectField name="urgency" label="Urgency" options={options(PRIORITY_LABELS)} />
          <MoneyField name="estimatedValue" label="Estimated value (ex GST)" />
          <SelectField
            name="assignedToId"
            label="Assigned to"
            options={staff}
            allowEmpty
            emptyLabel="Unassigned"
          />
          <TextField name="followUpAt" label="Follow up on" type="date" />
          {lead && (
            <SelectField
              name="status"
              label="Status"
              options={options(LEAD_STATUS_LABELS).filter(
                (o) => o.value !== "LOST" || lead.status === "LOST",
              )}
            />
          )}
        </div>
        <TextareaField name="message" label="What do they need?" rows={3} />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>{lead ? "Save lead" : "Create lead"}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
