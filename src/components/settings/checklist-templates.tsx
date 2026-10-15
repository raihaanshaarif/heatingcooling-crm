"use client";

import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { SubmitButton } from "@/components/forms/submit-button";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { JOB_TYPE_LABELS, SERVICE_CATEGORY_LABELS, options } from "@/lib/labels";
import { checklistTemplateSchema, type ChecklistTemplateInput } from "@/lib/validations/settings";
import { deleteChecklistTemplate, saveChecklistTemplate } from "@/server/settings-actions";
import type { JobType, ServiceCategory } from "@prisma/client";

export interface TemplateRow {
  id: string;
  name: string;
  jobType: JobType | null;
  serviceCategory: ServiceCategory | null;
  items: string[];
  active: boolean;
}

function TemplateForm({ template, onDone }: { template?: TemplateRow; onDone?: () => void }) {
  const router = useRouter();
  const form = useZodForm(checklistTemplateSchema, {
    defaultValues: {
      id: template?.id,
      name: template?.name ?? "",
      jobType: template?.jobType ?? null,
      serviceCategory: template?.serviceCategory ?? null,
      items: template?.items.join("\n") ?? "",
      active: template?.active ?? true,
    },
  });
  const action = useAction((v: ChecklistTemplateInput) => saveChecklistTemplate(v), {
    successMessage: "Checklist saved",
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
        <TextField name="name" label="Name" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            name="jobType"
            label="Job type"
            options={options(JOB_TYPE_LABELS)}
            allowEmpty
            emptyLabel="Any"
          />
          <SelectField
            name="serviceCategory"
            label="Service category"
            options={options(SERVICE_CATEGORY_LABELS)}
            allowEmpty
            emptyLabel="Any"
          />
        </div>
        <TextareaField name="items" label="Items (one per line)" rows={10} />
        <SwitchField name="active" label="Active" />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Save checklist</SubmitButton>
        </div>
      </form>
    </Form>
  );
}

export function ChecklistTemplates({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const remove = useAction(deleteChecklistTemplate, {
    successMessage: "Checklist deleted",
    onSuccess: () => router.refresh(),
  });
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        New jobs get the checklist that best matches their category and type. Technicians tick items
        off on their phone.
      </p>
      <FormDialog
        title="New checklist"
        wide
        trigger={
          <Button>
            <Plus /> New checklist
          </Button>
        }
      >
        {(close) => <TemplateForm onDone={close} />}
      </FormDialog>
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg border p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{t.name}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge variant="secondary">
                    {t.jobType ? JOB_TYPE_LABELS[t.jobType] : "Any type"}
                  </Badge>
                  <Badge variant="secondary">
                    {t.serviceCategory
                      ? SERVICE_CATEGORY_LABELS[t.serviceCategory]
                      : "Any category"}
                  </Badge>
                  {!t.active && <Badge variant="muted">Inactive</Badge>}
                </div>
              </div>
              <div className="flex">
                <FormDialog
                  title={`Edit ${t.name}`}
                  wide
                  trigger={
                    <Button variant="ghost" size="icon" aria-label="Edit checklist">
                      <Pencil />
                    </Button>
                  }
                >
                  {(close) => <TemplateForm template={t} onDone={close} />}
                </FormDialog>
                <ConfirmButton
                  title={`Delete ${t.name}?`}
                  description="Existing jobs keep their checklist items."
                  confirmLabel="Delete"
                  destructive
                  variant="ghost"
                  size="icon"
                  onConfirm={() => remove.run({ id: t.id })}
                >
                  <Trash2 />
                  <span className="sr-only">Delete checklist</span>
                </ConfirmButton>
              </div>
            </div>
            <ol className="text-muted-foreground mt-3 list-decimal space-y-0.5 pl-5 text-sm">
              {t.items.slice(0, 6).map((item) => (
                <li key={item}>{item}</li>
              ))}
              {t.items.length > 6 && <li className="list-none">…and {t.items.length - 6} more</li>}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
