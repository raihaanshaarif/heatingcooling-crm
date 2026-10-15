"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { useAction } from "@/components/forms/use-action";
import { deleteLicence } from "@/server/team/actions";

export function DeleteLicenceButton({ id }: { id: string }) {
  const router = useRouter();
  const action = useAction(deleteLicence, {
    successMessage: "Licence removed",
    onSuccess: () => router.refresh(),
  });
  return (
    <ConfirmButton
      title="Remove this licence?"
      confirmLabel="Remove"
      destructive
      variant="ghost"
      size="icon"
      onConfirm={() => action.run({ id })}
    >
      <Trash2 />
      <span className="sr-only">Remove licence</span>
    </ConfirmButton>
  );
}
