"use client";

import { useRouter } from "next/navigation";
import { useWatch } from "react-hook-form";
import { Form } from "@/components/ui/form";
import { SwitchField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import {
  SMS_SAMPLE_VARS,
  SMS_TEMPLATE_DESCRIPTIONS,
  SMS_TEMPLATE_LABELS,
  SMS_TEMPLATE_VARIABLES,
  renderSms,
} from "@/lib/sms/templates";
import {
  SMS_AUTO_KEYS,
  SMS_TEMPLATE_KEYS,
  smsSettingsSchema,
  type SmsAutoKey,
  type SmsSettings,
  type SmsSettingsInput,
  type SmsTemplateKey,
} from "@/lib/validations/settings";
import { saveSmsSettings } from "@/server/settings-actions";
import { SmsCounter } from "./sms-counter";

function Preview({ name }: { name: `templates.${SmsTemplateKey}` }) {
  const template = (useWatch({ name }) as string | undefined) ?? "";
  const text = renderSms(template, SMS_SAMPLE_VARS);
  return (
    <div className="bg-muted/50 space-y-1 rounded-md p-3">
      <p className="text-muted-foreground text-xs font-medium">Preview with example details</p>
      <p className="text-sm whitespace-pre-line">{text || "–"}</p>
      <SmsCounter text={text} />
    </div>
  );
}

export function SmsSettingsForm({ settings }: { settings: SmsSettings }) {
  const router = useRouter();
  const form = useZodForm(smsSettingsSchema, { defaultValues: settings });
  const action = useAction((v: SmsSettingsInput) => saveSmsSettings(v), {
    successMessage: "SMS settings saved",
    onSuccess: () => router.refresh(),
  });
  const isAuto = (k: SmsTemplateKey): k is SmsAutoKey =>
    (SMS_AUTO_KEYS as readonly string[]).includes(k);
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-8"
        noValidate
      >
        {SMS_TEMPLATE_KEYS.map((key) => (
          <fieldset key={key} className="space-y-3" data-testid={`sms-template-${key}`}>
            <legend className="font-medium">{SMS_TEMPLATE_LABELS[key]}</legend>
            {isAuto(key) ? (
              <SwitchField
                name={`enabled.${key}`}
                label={`Send “${SMS_TEMPLATE_LABELS[key]}” texts`}
                description={SMS_TEMPLATE_DESCRIPTIONS[key]}
              />
            ) : (
              <p className="text-muted-foreground text-sm">{SMS_TEMPLATE_DESCRIPTIONS[key]}</p>
            )}
            <TextareaField
              name={`templates.${key}`}
              label="Message"
              rows={3}
              description={`Placeholders: ${SMS_TEMPLATE_VARIABLES[key].map((v) => `{{${v}}}`).join(" ")}`}
            />
            <Preview name={`templates.${key}`} />
          </fieldset>
        ))}
        <SubmitButton pending={action.pending}>Save SMS settings</SubmitButton>
      </form>
    </Form>
  );
}
