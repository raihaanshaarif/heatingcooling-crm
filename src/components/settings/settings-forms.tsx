"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BusinessSettings } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { PAYMENT_TERMS_LABELS, options } from "@/lib/labels";
import { AU_STATES } from "@/lib/validations/common";
import {
  businessSettingsSchema,
  invoicingSettingsSchema,
  numberingSettingsSchema,
  type BusinessSettingsInput,
  type InvoicingSettingsInput,
  type NumberingSettingsInput,
} from "@/lib/validations/settings";
import {
  removeLogo,
  saveBusinessSettings,
  saveInvoicingSettings,
  saveNumberingSettings,
  uploadLogo,
} from "@/server/settings-actions";

export function BusinessSettingsForm({ settings }: { settings: BusinessSettings }) {
  const router = useRouter();
  const form = useZodForm(businessSettingsSchema, {
    defaultValues: {
      businessName: settings.businessName,
      tradingName: settings.tradingName ?? "",
      abn: settings.abn ?? "",
      email: settings.email ?? "",
      phone: settings.phone ?? "",
      website: settings.website ?? "",
      addressLine1: settings.addressLine1 ?? "",
      addressLine2: settings.addressLine2 ?? "",
      suburb: settings.suburb ?? "",
      state: (settings.state as BusinessSettingsInput["state"]) ?? "VIC",
      postcode: settings.postcode ?? "",
    },
  });
  const action = useAction((v: BusinessSettingsInput) => saveBusinessSettings(v), {
    successMessage: "Business details saved",
    onSuccess: () => router.refresh(),
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-6">
          <TextField name="businessName" label="Legal business name" className="sm:col-span-3" />
          <TextField name="tradingName" label="Trading name" className="sm:col-span-3" />
          <TextField
            name="abn"
            label="ABN"
            className="sm:col-span-2"
            description="Printed on every tax invoice."
          />
          <TextField name="phone" label="Phone" type="tel" className="sm:col-span-2" />
          <TextField name="email" label="Email" type="email" className="sm:col-span-2" />
          <TextField name="website" label="Website" className="sm:col-span-6" />
          <TextField name="addressLine1" label="Address" className="sm:col-span-6" />
          <TextField name="addressLine2" label="Address line 2" className="sm:col-span-6" />
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
        <SubmitButton pending={action.pending}>Save</SubmitButton>
      </form>
    </Form>
  );
}

export function LogoUpload({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const remove = useAction(removeLogo, {
    successMessage: "Logo removed",
    onSuccess: () => router.refresh(),
  });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="bg-muted flex h-20 w-40 items-center justify-center overflow-hidden rounded-md border">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploaded logo
          <img src={logoUrl} alt="Business logo" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-muted-foreground text-xs">No logo</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => input.current?.click()}
        >
          {pending ? <Loader2 className="animate-spin" /> : <ImageUp />} Upload logo
        </Button>
        {logoUrl && (
          <Button
            type="button"
            variant="ghost"
            disabled={remove.pending}
            onClick={() => void remove.run(undefined)}
          >
            <Trash2 /> Remove
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const data = new FormData();
          data.set("logo", file);
          start(async () => {
            const result = await uploadLogo(data);
            if (result.ok) {
              toast.success("Logo updated");
              router.refresh();
            } else toast.error(result.error);
          });
        }}
      />
      <p className="text-muted-foreground w-full text-xs">
        PNG or JPG, under 2 MB. Shown on quotes, invoices and client pages.
      </p>
    </div>
  );
}

export function InvoicingSettingsForm({ settings }: { settings: BusinessSettings }) {
  const router = useRouter();
  const form = useZodForm(invoicingSettingsSchema, {
    defaultValues: {
      gstRegistered: settings.gstRegistered,
      defaultPaymentTerms: settings.defaultPaymentTerms,
      quoteValidityDays: settings.quoteValidityDays,
      bankName: settings.bankName ?? "",
      bsb: settings.bsb ?? "",
      accountNumber: settings.accountNumber ?? "",
      accountName: settings.accountName ?? "",
      invoiceFooter: settings.invoiceFooter ?? "",
      quoteTerms: settings.quoteTerms ?? "",
    },
  });
  const action = useAction((v: InvoicingSettingsInput) => saveInvoicingSettings(v), {
    successMessage: "Invoicing settings saved",
    onSuccess: () => router.refresh(),
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        <SwitchField
          name="gstRegistered"
          label="Registered for GST"
          description="Adds 10% GST to taxable lines and titles invoices “Tax Invoice”."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            name="defaultPaymentTerms"
            label="Default payment terms"
            options={options(PAYMENT_TERMS_LABELS)}
          />
          <TextField name="quoteValidityDays" label="Quotes valid for (days)" inputMode="numeric" />
          <TextField name="accountName" label="Account name" />
          <TextField name="bankName" label="Bank" />
          <TextField name="bsb" label="BSB" inputMode="numeric" placeholder="063-000" />
          <TextField name="accountNumber" label="Account number" inputMode="numeric" />
        </div>
        <TextareaField name="quoteTerms" label="Quote terms & conditions" rows={5} />
        <TextareaField
          name="invoiceFooter"
          label="Invoice footer"
          rows={3}
          placeholder="Thank you for your business. Payment due within the terms above."
        />
        <SubmitButton pending={action.pending}>Save</SubmitButton>
      </form>
    </Form>
  );
}

export function NumberingSettingsForm({ settings }: { settings: BusinessSettings }) {
  const router = useRouter();
  const form = useZodForm(numberingSettingsSchema, {
    defaultValues: {
      quotePrefix: settings.quotePrefix,
      jobPrefix: settings.jobPrefix,
      invoicePrefix: settings.invoicePrefix,
      creditNotePrefix: settings.creditNotePrefix,
    },
  });
  const action = useAction((v: NumberingSettingsInput) => saveNumberingSettings(v), {
    successMessage: "Prefixes saved",
    onSuccess: () => router.refresh(),
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <TextField name="quotePrefix" label="Quotes" />
          <TextField name="jobPrefix" label="Jobs" />
          <TextField name="invoicePrefix" label="Invoices" />
          <TextField name="creditNotePrefix" label="Credit notes" />
        </div>
        <SubmitButton pending={action.pending}>Save prefixes</SubmitButton>
      </form>
    </Form>
  );
}
