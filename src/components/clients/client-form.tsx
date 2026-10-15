"use client";

import { useRouter } from "next/navigation";
import { useZodForm } from "@/components/forms/use-zod-form";
import type { Client } from "@prisma/client";
import { Form } from "@/components/ui/form";
import {
  CheckboxField,
  CheckboxGroupField,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { CLIENT_TAGS, CLIENT_TYPE_LABELS, LEAD_SOURCE_LABELS, options } from "@/lib/labels";
import { AU_STATES } from "@/lib/validations/common";
import { clientSchema, type ClientInput } from "@/lib/validations/clients";
import { createClient, updateClient } from "@/server/clients/actions";

export function ClientForm({ client, onDone }: { client?: Client; onDone?: () => void }) {
  const router = useRouter();
  const form = useZodForm(clientSchema, {
    defaultValues: {
      type: client?.type ?? "RESIDENTIAL",
      name: client?.name ?? "",
      companyName: client?.companyName ?? "",
      abn: client?.abn ?? "",
      email: client?.email ?? "",
      phone: client?.phone ?? "",
      altPhone: client?.altPhone ?? "",
      billingLine1: client?.billingLine1 ?? "",
      billingLine2: client?.billingLine2 ?? "",
      billingSuburb: client?.billingSuburb ?? "",
      billingState: (client?.billingState as ClientInput["billingState"]) ?? "VIC",
      billingPostcode: client?.billingPostcode ?? "",
      notes: client?.notes ?? "",
      tags: client?.tags ?? [],
      source: client?.source ?? null,
      doNotService: client?.doNotService ?? false,
      noSms: client?.noSms ?? false,
      createPropertyFromBilling: !client,
    },
  });
  const type = form.watch("type");
  const action = useAction(
    (values: ClientInput) => (client ? updateClient(client.id, values) : createClient(values)),
    {
      successMessage: client ? "Client updated" : "Client created",
      onSuccess: (data) => {
        onDone?.();
        if (!client) router.push(`/clients/${data.id}`);
        else router.refresh();
      },
    },
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField name="type" label="Client type" options={options(CLIENT_TYPE_LABELS)} />
          <SelectField
            name="source"
            label="How they found us"
            options={options(LEAD_SOURCE_LABELS)}
            allowEmpty
            emptyLabel="Unknown"
          />
          <TextField
            name="name"
            label={type === "RESIDENTIAL" ? "Full name" : "Contact name"}
            autoComplete="name"
          />
          {type !== "RESIDENTIAL" && <TextField name="companyName" label="Company / agency" />}
          {type !== "RESIDENTIAL" && (
            <TextField name="abn" label="ABN" placeholder="12 345 678 901" />
          )}
          <TextField name="phone" label="Phone" type="tel" placeholder="0412 345 678" />
          <TextField name="altPhone" label="Alternate phone" type="tel" />
          <TextField name="email" label="Email" type="email" className="sm:col-span-2" />
        </div>
        <fieldset className="grid gap-4 sm:grid-cols-6">
          <legend className="mb-2 text-sm font-medium">Billing address</legend>
          <TextField
            name="billingLine1"
            label="Street address"
            className="sm:col-span-6"
            autoComplete="address-line1"
          />
          <TextField
            name="billingLine2"
            label="Unit / building (optional)"
            className="sm:col-span-6"
          />
          <TextField name="billingSuburb" label="Suburb" className="sm:col-span-3" />
          <SelectField
            name="billingState"
            label="State"
            className="sm:col-span-1"
            options={AU_STATES.map((s) => ({ value: s, label: s }))}
          />
          <TextField
            name="billingPostcode"
            label="Postcode"
            className="sm:col-span-2"
            inputMode="numeric"
          />
        </fieldset>
        {!client && (
          <CheckboxField
            name="createPropertyFromBilling"
            label="This is also the service address"
            description="Creates the first property for this client from the address above."
          />
        )}
        <CheckboxGroupField
          name="tags"
          label="Tags"
          options={CLIENT_TAGS.map((t) => ({ value: t, label: t }))}
        />
        <SwitchField
          name="doNotService"
          label="Do not service"
          description="Warn the office when booking work for this client."
        />
        <SwitchField
          name="noSms"
          label="No SMS"
          description="The client asked not to be texted. No reminders, on-my-way or one-off texts."
        />
        <TextareaField name="notes" label="Notes" rows={3} />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>
            {client ? "Save changes" : "Create client"}
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
