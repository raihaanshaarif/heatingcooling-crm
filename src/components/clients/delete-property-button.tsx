"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { useAction } from "@/components/forms/use-action";
import { deleteProperty } from "@/server/clients/actions";

export function DeletePropertyButton({ id }: { id: string }) {
  const router = useRouter();
  const action = useAction(deleteProperty, {
    successMessage: "Property deleted",
    onSuccess: (d) => router.push(`/clients/${d.clientId}?tab=properties`),
  });
  return (
    <ConfirmButton
      title="Delete this property?"
      description="Its equipment records are deleted too. Properties with jobs can't be deleted."
      confirmLabel="Delete"
      destructive
      variant="ghost"
      size="icon"
      onConfirm={() => action.run({ id })}
    >
      <Trash2 />
      <span className="sr-only">Delete property</span>
    </ConfirmButton>
  );
}
