"use client";

import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import { TextField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import {
  EMAIL_TEMPLATE_LABELS,
  EMAIL_TEMPLATE_VARIABLES,
  type EmailTemplate,
} from "@/lib/email/templates";
import {
  EMAIL_TEMPLATE_KEYS,
  emailTemplatesSchema,
  type EmailTemplateKey,
  type EmailTemplatesInput,
} from "@/lib/validations/settings";
import { saveEmailTemplates } from "@/server/settings-actions";

export function EmailTemplatesForm({
  templates,
}: {
  templates: Record<EmailTemplateKey, EmailTemplate>;
}) {
  const router = useRouter();
  const form = useZodForm(emailTemplatesSchema, { defaultValues: templates });
  const action = useAction((v: EmailTemplatesInput) => saveEmailTemplates(v), {
    successMessage: "Email templates saved",
    onSuccess: () => router.refresh(),
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-8"
        noValidate
      >
        {EMAIL_TEMPLATE_KEYS.map((key) => (
          <fieldset key={key} className="space-y-3">
            <legend className="font-medium">{EMAIL_TEMPLATE_LABELS[key]}</legend>
            <TextField name={`${key}.subject`} label="Subject" />
            <TextareaField
              name={`${key}.body`}
              label="Message"
              rows={5}
              description={`Placeholders: ${EMAIL_TEMPLATE_VARIABLES[key].map((v) => `{{${v}}}`).join(" ")}`}
            />
          </fieldset>
        ))}
        <SubmitButton pending={action.pending}>Save templates</SubmitButton>
      </form>
    </Form>
  );
}
