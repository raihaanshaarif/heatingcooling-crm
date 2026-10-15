"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { useAction } from "@/components/forms/use-action";
import { deletePayment } from "@/server/payments/actions";

export function DeletePaymentButton({ id }: { id: string }) {
  const router = useRouter();
  const action = useAction(deletePayment, {
    successMessage: "Payment removed",
    onSuccess: () => router.refresh(),
  });
  return (
    <ConfirmButton
      title="Remove this payment?"
      description="The invoice balance and status are recalculated."
      confirmLabel="Remove"
      destructive
      variant="ghost"
      size="icon"
      onConfirm={() => action.run({ id })}
    >
      <Trash2 />
      <span className="sr-only">Remove payment</span>
    </ConfirmButton>
  );
}
