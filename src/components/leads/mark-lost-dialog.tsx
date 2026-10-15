"use client";

import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { LOST_REASONS } from "@/lib/labels";
import { markLostSchema } from "@/lib/validations/leads";
import { markLeadLost } from "@/server/leads/actions";

function MarkLostForm({ leadId, onDone }: { leadId: string; onDone: (ok: boolean) => void }) {
  const router = useRouter();
  const form = useZodForm(markLostSchema, {
    defaultValues: { id: leadId, lostReason: "", note: "" },
  });
  const action = useAction(markLeadLost, {
    successMessage: "Lead marked lost",
    onSuccess: () => {
      onDone(true);
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
        <SelectField
          name="lostReason"
          label="Why was it lost?"
          options={LOST_REASONS.map((r) => ({ value: r, label: r }))}
        />
        <TextareaField name="note" label="Notes (optional)" rows={2} />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Mark lost</SubmitButton>
        </div>
      </form>
    </Form>
  );
}

export function MarkLostDialog({
  leadId,
  open,
  onOpenChange,
  onDone,
  trigger,
}: {
  leadId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onDone?: (ok: boolean) => void;
  trigger?: React.ReactNode;
}) {
  return (
    <FormDialog
      title="Mark lead as lost"
      description="Recording the reason shows which leads you lose on price, timing or follow-up."
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
    >
      {(close) => (
        <MarkLostForm
          leadId={leadId}
          onDone={(ok) => {
            close();
            onDone?.(ok);
          }}
        />
      )}
    </FormDialog>
  );
}
