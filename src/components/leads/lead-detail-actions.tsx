"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Pencil, Trash2, XCircle } from "lucide-react";
import type { Lead, LeadStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { CLIENT_TYPE_LABELS, LEAD_STATUS_LABELS, options } from "@/lib/labels";
import { toDateInput } from "@/lib/dates";
import { AU_STATES } from "@/lib/validations/common";
import { convertLeadSchema } from "@/lib/validations/leads";
import { convertLead, deleteLead, setLeadFollowUp, updateLeadStatus } from "@/server/leads/actions";
import { LeadForm } from "./lead-form";
import { MarkLostDialog } from "./mark-lost-dialog";

function ConvertForm({
  lead,
  clients,
  onDone,
}: {
  lead: Lead;
  clients: { value: string; label: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(convertLeadSchema, {
    defaultValues: {
      id: lead.id,
      existingClientId: lead.clientId,
      clientType: "RESIDENTIAL",
      addressLine1: "",
      suburb: lead.suburb ?? "",
      state: "VIC",
      postcode: lead.postcode ?? "",
      next: "quote",
    },
  });
  const existing = form.watch("existingClientId");
  const action = useAction(convertLead, {
    successMessage: "Lead converted",
    onSuccess: (d) => {
      onDone();
      router.push(d.redirectTo);
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
          name="existingClientId"
          label="Client"
          options={clients}
          allowEmpty
          emptyLabel={`Create new client “${lead.name}”`}
        />
        <div className="grid gap-4 sm:grid-cols-6">
          {!existing && (
            <SelectField
              name="clientType"
              label="Client type"
              options={options(CLIENT_TYPE_LABELS)}
              className="sm:col-span-6"
            />
          )}
          <TextField
            name="addressLine1"
            label={existing ? "Add a new property (optional)" : "Service address"}
            className="sm:col-span-6"
          />
          <TextField name="suburb" label="Suburb" className="sm:col-span-3" />
          <SelectField
            name="state"
            label="State"
            className="sm:col-span-1"
            options={AU_STATES.map((s) => ({ value: s, label: s }))}
          />
          <TextField name="postcode" label="Postcode" className="sm:col-span-2" />
        </div>
        <SelectField
          name="next"
          label="Then"
          options={[
            { value: "quote", label: "Create a quote" },
            { value: "job", label: "Create a job (marks lead won)" },
            { value: "none", label: "Just create the client" },
          ]}
        />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Convert</SubmitButton>
        </div>
      </form>
    </Form>
  );
}

export function LeadHeaderActions({
  lead,
  staff,
  clients,
  canEdit,
  canDelete,
}: {
  lead: Lead;
  staff: { value: string; label: string }[];
  clients: { value: string; label: string }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const remove = useAction(deleteLead, {
    successMessage: "Lead deleted",
    onSuccess: () => router.push("/leads"),
  });
  if (!canEdit) return null;
  return (
    <>
      <FormDialog
        title="Convert to client"
        description="Creates the client and property, then takes you to the quote or job."
        trigger={
          <Button>
            <ArrowRightLeft /> Convert
          </Button>
        }
      >
        {(close) => <ConvertForm lead={lead} clients={clients} onDone={close} />}
      </FormDialog>
      <FormDialog
        title="Edit lead"
        wide
        trigger={
          <Button variant="outline">
            <Pencil /> Edit
          </Button>
        }
      >
        {(close) => <LeadForm lead={lead} staff={staff} onDone={close} />}
      </FormDialog>
      {lead.status !== "LOST" && (
        <MarkLostDialog
          leadId={lead.id}
          trigger={
            <Button variant="outline">
              <XCircle /> Mark lost
            </Button>
          }
        />
      )}
      {canDelete && (
        <ConfirmButton
          title="Delete this lead?"
          confirmLabel="Delete"
          destructive
          variant="ghost"
          size="icon"
          onConfirm={() => remove.run({ id: lead.id })}
        >
          <Trash2 />
          <span className="sr-only">Delete lead</span>
        </ConfirmButton>
      )}
    </>
  );
}

export function LeadStatusControl({
  id,
  status,
  disabled,
}: {
  id: string;
  status: LeadStatus;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [losing, setLosing] = useState(false);
  const action = useAction(updateLeadStatus, {
    successMessage: "Status updated",
    onSuccess: () => router.refresh(),
  });
  return (
    <>
      <Select
        value={status}
        disabled={disabled || action.pending}
        onValueChange={(v) => {
          if (v === "LOST") setLosing(true);
          else void action.run({ id, status: v as LeadStatus });
        }}
      >
        <SelectTrigger className="w-full" aria-label="Lead status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options(LEAD_STATUS_LABELS).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {losing && <MarkLostDialog leadId={id} open onOpenChange={setLosing} />}
    </>
  );
}

export function FollowUpControl({
  id,
  followUpAt,
  disabled,
}: {
  id: string;
  followUpAt: Date | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(toDateInput(followUpAt));
  const action = useAction(setLeadFollowUp, {
    successMessage: "Follow-up saved",
    onSuccess: () => router.refresh(),
  });
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run({ id, followUpAt: value || null });
      }}
    >
      <div className="grid flex-1 gap-1.5">
        <Label htmlFor="followUp">Follow up on</Label>
        <Input
          id="followUp"
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
        />
      </div>
      <Button type="submit" variant="outline" disabled={disabled || action.pending}>
        Save
      </Button>
    </form>
  );
}
