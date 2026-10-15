"use client";

import { useRouter } from "next/navigation";
import type { TechnicianLicence } from "@prisma/client";
import { Form } from "@/components/ui/form";
import { SelectField, TextField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { LICENCE_TYPE_LABELS, options } from "@/lib/labels";
import { toDateInput } from "@/lib/dates";
import { licenceSchema, type LicenceInput } from "@/lib/validations/team";
import { saveLicence } from "@/server/team/actions";

export function LicenceForm({
  userId,
  licence,
  onDone,
}: {
  userId: string;
  licence?: TechnicianLicence;
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(licenceSchema, {
    defaultValues: {
      userId,
      type: licence?.type ?? "ARC_REFRIGERANT",
      number: licence?.number ?? "",
      issuedAt: toDateInput(licence?.issuedAt),
      expiresAt: toDateInput(licence?.expiresAt),
      fileUrl: licence?.fileUrl ?? "",
    },
  });
  const action = useAction((v: LicenceInput) => saveLicence(licence?.id ?? null, v), {
    successMessage: "Licence saved",
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
          <SelectField name="type" label="Type" options={options(LICENCE_TYPE_LABELS)} />
          <TextField name="number" label="Licence number" />
          <TextField name="issuedAt" label="Issued" type="date" />
          <TextField name="expiresAt" label="Expires" type="date" />
        </div>
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Save licence</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
