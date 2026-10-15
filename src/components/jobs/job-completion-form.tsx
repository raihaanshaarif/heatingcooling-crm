"use client";

import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import { TextField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { jobCompletionSchema, type JobCompletionInput } from "@/lib/validations/jobs";
import { saveJobCompletion } from "@/server/jobs/actions";

/** Completion notes, refrigerant handling record (ARC) and gas compliance certificate. */
export function JobCompletionForm({
  job,
  showGas,
  onDone,
}: {
  job: {
    id: string;
    completionNotes: string | null;
    refrigerantRecoveredKg: number | null;
    refrigerantAddedKg: number | null;
    gasComplianceCertNumber: string | null;
    signedByName: string | null;
  };
  showGas: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(jobCompletionSchema, {
    defaultValues: {
      id: job.id,
      completionNotes: job.completionNotes ?? "",
      refrigerantRecoveredKg:
        job.refrigerantRecoveredKg != null ? String(job.refrigerantRecoveredKg) : "",
      refrigerantAddedKg: job.refrigerantAddedKg != null ? String(job.refrigerantAddedKg) : "",
      gasComplianceCertNumber: job.gasComplianceCertNumber ?? "",
      signedByName: job.signedByName ?? "",
    },
  });
  const action = useAction((v: JobCompletionInput) => saveJobCompletion(v), {
    successMessage: "Completion details saved",
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
        <TextareaField
          name="completionNotes"
          label="Work performed"
          rows={4}
          placeholder="What was done, findings, recommendations…"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="refrigerantRecoveredKg"
            label="Refrigerant recovered (kg)"
            inputMode="decimal"
          />
          <TextField name="refrigerantAddedKg" label="Refrigerant added (kg)" inputMode="decimal" />
          {showGas && (
            <TextField name="gasComplianceCertNumber" label="Gas compliance certificate no." />
          )}
        </div>
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Save</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
