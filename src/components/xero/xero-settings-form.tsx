"use client";

import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import { SelectField, SwitchField, TextField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import {
  xeroSettingsSchema,
  type XeroSettings,
  type XeroSettingsInput,
} from "@/lib/validations/settings";
import { saveXeroSettings } from "@/server/xero/actions";
import type { XeroOptions } from "@/server/xero/queries";

/** Keep the saved value selectable even when Xero no longer lists it. */
function withCurrent(options: { value: string; label: string }[], current: string | null) {
  if (!current || options.some((o) => o.value === current)) return options;
  return [{ value: current, label: `${current} (saved)` }, ...options];
}

export function XeroSettingsForm({
  settings,
  options,
}: {
  settings: XeroSettings;
  /** Accounts and tax rates from Xero; null when not connected (plain text fields instead). */
  options: XeroOptions | null;
}) {
  const router = useRouter();
  const form = useZodForm(xeroSettingsSchema, { defaultValues: settings });
  const action = useAction((v: XeroSettingsInput) => saveXeroSettings(v), {
    successMessage: "Xero settings saved",
    onSuccess: () => router.refresh(),
  });
  const taxOptions = options?.taxRates.map((t) => ({
    value: t.type,
    label: `${t.name}${t.rate !== null ? ` (${t.rate}%)` : ""} · ${t.type}`,
  }));
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-6"
        noValidate
        data-testid="xero-settings-form"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {options?.revenueAccounts.length ? (
            <SelectField
              name="salesAccountCode"
              label="Sales account"
              options={withCurrent(
                options.revenueAccounts.map((a) => ({
                  value: a.code,
                  label: `${a.code} · ${a.name}`,
                })),
                settings.salesAccountCode,
              )}
              description="Every invoice and credit note line is coded to this account."
            />
          ) : (
            <TextField
              name="salesAccountCode"
              label="Sales account code"
              description="Xero's default Sales account is 200."
            />
          )}
          <SelectField
            name="invoiceStatus"
            label="Send invoices to Xero as"
            options={[
              { value: "AUTHORISED", label: "Approved (Awaiting payment)" },
              { value: "DRAFT", label: "Draft (approve them in Xero)" },
            ]}
            description="Payments and credit-note allocations can only be added once an invoice is approved."
          />
          {taxOptions?.length ? (
            <>
              <SelectField
                name="taxTypeTaxable"
                label="Tax rate for GST lines"
                options={withCurrent(taxOptions, settings.taxTypeTaxable)}
              />
              <SelectField
                name="taxTypeFree"
                label="Tax rate for GST-free lines"
                options={withCurrent(taxOptions, settings.taxTypeFree)}
              />
            </>
          ) : (
            <>
              <TextField
                name="taxTypeTaxable"
                label="Tax rate for GST lines"
                description="OUTPUT = GST on Income (10%)."
              />
              <TextField
                name="taxTypeFree"
                label="Tax rate for GST-free lines"
                description="EXEMPTOUTPUT = GST Free Income."
              />
            </>
          )}
          {options ? (
            <SelectField
              name="bankAccountId"
              label="Bank account for payments"
              placeholder="Choose a bank account"
              allowEmpty
              emptyLabel="Not chosen (payments won't sync)"
              options={withCurrent(
                options.bankAccounts.map((a) => ({
                  value: a.id,
                  label: `${a.name}${a.code ? ` · ${a.code}` : ""}`,
                })),
                settings.bankAccountId,
              )}
              onValueChange={(id) => {
                const account = options.bankAccounts.find((a) => a.id === id);
                form.setValue("bankAccountCode", account?.code ?? null);
                form.setValue("bankAccountName", account?.name ?? null);
              }}
              description="Payments and refunds recorded in CoolOps go into this account in Xero."
            />
          ) : (
            <TextField
              name="bankAccountCode"
              label="Bank account code for payments"
              description="Connect Xero to pick from your bank accounts, or type the account's code from Xero's chart of accounts."
            />
          )}
        </div>
        <SwitchField
          name="autoSync"
          label="Sync automatically"
          description="On: changes go to Xero straight after they're saved, and the daily run catches up anything that failed. Off: nothing is sent until someone clicks Sync now."
        />
        <SubmitButton pending={action.pending}>Save Xero settings</SubmitButton>
      </form>
    </Form>
  );
}
