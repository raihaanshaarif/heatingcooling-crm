"use client";

import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import type { Client } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import { deleteClient } from "@/server/clients/actions";
import { ClientForm } from "./client-form";

export function ClientActions({
  client,
  canEdit,
  canDelete,
}: {
  client: Client;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const remove = useAction(deleteClient, {
    successMessage: "Client deleted",
    onSuccess: () => router.push("/clients"),
  });
  return (
    <>
      {canEdit && (
        <FormDialog
          title="Edit client"
          wide
          trigger={
            <Button variant="outline">
              <Pencil /> Edit
            </Button>
          }
        >
          {(close) => <ClientForm client={client} onDone={close} />}
        </FormDialog>
      )}
      {canDelete && (
        <ConfirmButton
          title={`Delete ${client.name}?`}
          description="The client is archived and hidden from lists. Their jobs, quotes and invoices stay in reports."
          confirmLabel="Delete client"
          destructive
          variant="ghost"
          size="icon"
          onConfirm={() => remove.run({ id: client.id })}
        >
          <Trash2 />
          <span className="sr-only">Delete client</span>
        </ConfirmButton>
      )}
    </>
  );
}
