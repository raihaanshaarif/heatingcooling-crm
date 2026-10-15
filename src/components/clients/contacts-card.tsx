"use client";

import { useRouter } from "next/navigation";
import { Mail, Pencil, Phone, Plus, Star, Trash2 } from "lucide-react";
import { useZodForm } from "@/components/forms/use-zod-form";
import type { Contact } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { CheckboxField, TextField } from "@/components/forms/fields";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { FormDialog } from "@/components/forms/form-dialog";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { contactSchema } from "@/lib/validations/clients";
import { deleteContact, saveContact } from "@/server/clients/actions";

function ContactForm({
  clientId,
  contact,
  onDone,
}: {
  clientId: string;
  contact?: Contact;
  onDone: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(contactSchema, {
    defaultValues: {
      id: contact?.id,
      clientId,
      name: contact?.name ?? "",
      role: contact?.role ?? "",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      isPrimary: contact?.isPrimary ?? false,
    },
  });
  const action = useAction(saveContact, {
    successMessage: "Contact saved",
    onSuccess: () => {
      onDone();
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
          <TextField name="name" label="Name" />
          <TextField name="role" label="Role" placeholder="Tenant, Owner, Site manager…" />
          <TextField name="phone" label="Phone" type="tel" />
          <TextField name="email" label="Email" type="email" />
        </div>
        <CheckboxField name="isPrimary" label="Primary contact" />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Save contact</SubmitButton>
        </div>
      </form>
    </Form>
  );
}

export function ContactsCard({
  clientId,
  contacts,
  canEdit,
}: {
  clientId: string;
  contacts: Contact[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const remove = useAction(deleteContact, {
    successMessage: "Contact removed",
    onSuccess: () => router.refresh(),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contacts</CardTitle>
        {canEdit && (
          <CardAction>
            <FormDialog
              title="Add contact"
              trigger={
                <Button size="sm" variant="outline">
                  <Plus /> Add
                </Button>
              }
            >
              {(close) => <ContactForm clientId={clientId} onDone={close} />}
            </FormDialog>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No extra contacts. Add tenants, owners or site managers here.
          </p>
        ) : (
          <ul className="divide-y">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {c.name}
                    {c.isPrimary && (
                      <Star
                        className="ml-1 inline size-3.5 fill-amber-400 text-amber-400"
                        aria-label="Primary"
                      />
                    )}
                    {c.role && (
                      <span className="text-muted-foreground font-normal"> · {c.role}</span>
                    )}
                  </p>
                  <div className="text-muted-foreground flex flex-wrap gap-x-3">
                    {c.phone && (
                      <a
                        href={`tel:${c.phone.replace(/\s/g, "")}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Phone className="size-3" /> {c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Mail className="size-3" /> {c.email}
                      </a>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <FormDialog
                      title="Edit contact"
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Edit ${c.name}`}
                        >
                          <Pencil />
                        </Button>
                      }
                    >
                      {(close) => <ContactForm clientId={clientId} contact={c} onDone={close} />}
                    </FormDialog>
                    <ConfirmButton
                      title={`Remove ${c.name}?`}
                      confirmLabel="Remove"
                      destructive
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onConfirm={() => remove.run({ id: c.id })}
                    >
                      <Trash2 />
                    </ConfirmButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
