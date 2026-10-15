"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Form } from "@/components/ui/form";
import {
  CheckboxGroupField,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { JOB_TYPE_LABELS, PRIORITY_LABELS, SERVICE_CATEGORY_LABELS, options } from "@/lib/labels";
import { toDateTimeInput } from "@/lib/dates";
import { jobSchema, type JobInput } from "@/lib/validations/jobs";
import { createJob, getPropertyEquipmentOptions, updateJob } from "@/server/jobs/actions";
import type { ClientOption } from "@/server/clients/queries";
import type { JobDetail } from "@/server/jobs/queries";

export interface TechnicianOption {
  value: string;
  label: string;
  color: string;
  hint?: string;
}

type EquipmentOption = { value: string; label: string; hint?: string };

export function JobForm({
  job,
  clients,
  technicians,
  defaults = {},
  onDone,
  navigate = true,
}: {
  job?: JobDetail;
  clients: ClientOption[];
  technicians: TechnicianOption[];
  defaults?: Partial<
    Pick<
      JobInput,
      | "clientId"
      | "propertyId"
      | "quoteId"
      | "maintenancePlanId"
      | "type"
      | "title"
      | "description"
      | "serviceCategory"
      | "assigneeIds"
    >
  > & {
    scheduledStart?: Date;
    scheduledEnd?: Date;
  };
  onDone?: () => void;
  /** Go to the new job after creating it (the schedule stays put instead). */
  navigate?: boolean;
}) {
  const router = useRouter();
  const form = useZodForm(jobSchema, {
    defaultValues: {
      clientId: job?.clientId ?? defaults.clientId ?? "",
      propertyId: job?.propertyId ?? defaults.propertyId ?? null,
      quoteId: job?.quoteId ?? defaults.quoteId ?? null,
      maintenancePlanId: job?.maintenancePlanId ?? defaults.maintenancePlanId ?? null,
      type: job?.type ?? defaults.type ?? "SERVICE",
      priority: job?.priority ?? "NORMAL",
      serviceCategory: job?.serviceCategory ?? defaults.serviceCategory ?? null,
      title: job?.title ?? defaults.title ?? "",
      description: job?.description ?? defaults.description ?? "",
      scheduledStart: toDateTimeInput(job ? job.scheduledStart : defaults.scheduledStart),
      scheduledEnd: toDateTimeInput(job ? job.scheduledEnd : defaults.scheduledEnd),
      estimatedMinutes: job?.estimatedMinutes != null ? String(job.estimatedMinutes) : "",
      assigneeIds: job?.assignments.map((a) => a.userId) ?? defaults.assigneeIds ?? [],
      equipmentIds: job?.equipment.map((e) => e.equipmentId) ?? [],
      applyChecklist: !job,
    },
  });
  const clientId = form.watch("clientId");
  const propertyId = form.watch("propertyId");
  const client = clients.find((c) => c.id === clientId);
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!propertyId) {
      setEquipment([]);
      return;
    }
    void getPropertyEquipmentOptions({ id: propertyId }).then((r) => {
      if (!cancelled && r.ok) setEquipment(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const action = useAction((v: JobInput) => (job ? updateJob(job.id, v) : createJob(v)), {
    successMessage: job ? "Job updated" : "Job created",
    onSuccess: (d) => {
      onDone?.();
      if (!job && navigate) router.push(`/jobs/${d.id}`);
      else router.refresh();
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
          <SelectField
            name="clientId"
            label="Client"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Choose a client"
            onValueChange={(id) => {
              const next = clients.find((c) => c.id === id);
              form.setValue("propertyId", next?.properties[0]?.id ?? null);
              form.setValue("equipmentIds", []);
            }}
          />
          <SelectField
            name="propertyId"
            label="Site"
            options={(client?.properties ?? []).map((p) => ({ value: p.id, label: p.label }))}
            allowEmpty
            emptyLabel="No site"
            onValueChange={() => form.setValue("equipmentIds", [])}
          />
          {client?.doNotService && (
            <p className="text-destructive flex items-center gap-2 text-sm sm:col-span-2">
              <AlertTriangle className="size-4" /> This client is flagged “Do not service”.
            </p>
          )}
          <TextField
            name="title"
            label="Title"
            placeholder="e.g. Annual service – 2 splits"
            className="sm:col-span-2"
          />
          <SelectField name="type" label="Job type" options={options(JOB_TYPE_LABELS)} />
          <SelectField
            name="serviceCategory"
            label="Category"
            options={options(SERVICE_CATEGORY_LABELS)}
            allowEmpty
            emptyLabel="None"
          />
          <SelectField name="priority" label="Priority" options={options(PRIORITY_LABELS)} />
          <TextField
            name="estimatedMinutes"
            label="Estimated minutes"
            inputMode="numeric"
            placeholder="120"
          />
          <TextField name="scheduledStart" label="Start" type="datetime-local" />
          <TextField
            name="scheduledEnd"
            label="End"
            type="datetime-local"
            description="Leave blank to use the estimate."
          />
        </div>
        <TextareaField
          name="description"
          label="Job description"
          rows={3}
          placeholder="What needs doing, access notes for the tech…"
        />
        <CheckboxGroupField name="assigneeIds" label="Technicians" options={technicians} />
        {propertyId && (
          <CheckboxGroupField
            name="equipmentIds"
            label="Equipment"
            options={equipment}
            emptyText="No equipment recorded at this site yet."
          />
        )}
        {!job && (
          <SwitchField
            name="applyChecklist"
            label="Add checklist"
            description="Adds the matching checklist template for this job type."
          />
        )}
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>{job ? "Save job" : "Create job"}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
