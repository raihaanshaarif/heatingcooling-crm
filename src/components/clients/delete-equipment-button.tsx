"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { useAction } from "@/components/forms/use-action";
import { deleteEquipment } from "@/server/equipment/actions";

export function DeleteEquipmentButton({ id }: { id: string }) {
  const router = useRouter();
  const action = useAction(deleteEquipment, {
    successMessage: "Equipment deleted",
    onSuccess: (d) => router.push(`/properties/${d.propertyId}`),
  });
  return (
    <ConfirmButton
      title="Delete this unit?"
      description="Its service history links are removed. Jobs themselves are kept."
      confirmLabel="Delete"
      destructive
      variant="ghost"
      size="icon"
      onConfirm={() => action.run({ id })}
    >
      <Trash2 />
      <span className="sr-only">Delete equipment</span>
    </ConfirmButton>
  );
}
