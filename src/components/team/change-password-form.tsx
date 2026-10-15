"use client";

import { Form } from "@/components/ui/form";
import { TextField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { changePasswordSchema } from "@/lib/validations/team";
import { changeOwnPassword } from "@/server/team/actions";
import type { z } from "zod";

export function ChangePasswordForm() {
  const form = useZodForm(changePasswordSchema, {
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const action = useAction((v: z.input<typeof changePasswordSchema>) => changeOwnPassword(v), {
    successMessage: "Password changed",
    onSuccess: () => form.reset(),
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="max-w-sm space-y-4"
        noValidate
      >
        <TextField
          name="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
        />
        <TextField
          name="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          description="At least 10 characters with a letter and a number."
        />
        <TextField
          name="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
        />
        <SubmitButton pending={action.pending}>Change password</SubmitButton>
      </form>
    </Form>
  );
}
