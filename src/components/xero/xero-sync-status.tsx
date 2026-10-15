"use client";

import { useRouter } from "next/navigation";
import { Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/forms/use-action";
import { retryXeroInvoice, retryXeroJob } from "@/server/xero/actions";

export function RetryXeroJobButton({ id, label = "Retry" }: { id: string; label?: string }) {
  const router = useRouter();
  const retry = useAction(retryXeroJob, {
    successMessage: (d) => d.message,
    onSuccess: () => router.refresh(),
    onError: () => router.refresh(),
  });
  return (
    <Button size="sm" variant="outline" onClick={() => retry.run({ id })} disabled={retry.pending}>
      {retry.pending ? <Loader2 className="animate-spin" /> : <RotateCw />}
      {label}
    </Button>
  );
}

export function RetryXeroInvoiceButton({ id, label = "Retry" }: { id: string; label?: string }) {
  const router = useRouter();
  const retry = useAction(retryXeroInvoice, {
    successMessage: (d) => d.message,
    onSuccess: () => router.refresh(),
    onError: () => router.refresh(),
  });
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => retry.run({ id })}
      disabled={retry.pending}
      data-testid="xero-retry-invoice"
    >
      {retry.pending ? <Loader2 className="animate-spin" /> : <RotateCw />}
      {label}
    </Button>
  );
}
