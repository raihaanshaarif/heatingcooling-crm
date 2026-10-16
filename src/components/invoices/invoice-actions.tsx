"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@prisma/client";
import {
  Ban,
  CheckCheck,
  Download,
  FileMinus,
  Link2,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import { deleteInvoice, markInvoiceSent, sendInvoice } from "@/server/invoices/actions";
import { PaymentForm } from "./payment-form";
import { CreditNoteForm, VoidInvoiceForm } from "./invoice-dialogs";

export function InvoiceActions({
  invoice,
  publicUrl,
  canEdit,
  canDelete,
  canPay,
}: {
  invoice: {
    id: string;
    number: string;
    status: InvoiceStatus;
    hasEmail: boolean;
    balanceCents: number;
    amountPaidCents: number;
    creditableCents: number;
  };
  publicUrl: string;
  canEdit: boolean;
  canDelete: boolean;
  canPay: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "credit" | "void">(null);
  const refresh = () => router.refresh();
  const send = useAction(sendInvoice, {
    successMessage: (d) =>
      d.skipped ? "Marked as sent (email not configured, logged to console)" : "Invoice emailed",
    onSuccess: refresh,
  });
  const markSent = useAction(markInvoiceSent, {
    successMessage: "Marked as sent",
    onSuccess: refresh,
  });
  const remove = useAction(deleteInvoice, {
    successMessage: "Invoice deleted",
    onSuccess: () => router.push("/invoices"),
  });
  const isVoid = invoice.status === "VOID";
  const editable =
    canEdit &&
    !isVoid &&
    invoice.amountPaidCents === 0 &&
    invoice.creditableCents === invoice.balanceCents;

  return (
    <>
      {canPay && !isVoid && invoice.balanceCents > 0 && invoice.status !== "DRAFT" && (
        <FormDialog
          title={`Record payment on ${invoice.number}`}
          trigger={
            <Button>
              <Wallet /> Record payment
            </Button>
          }
        >
          {(close) => (
            <PaymentForm
              invoiceId={invoice.id}
              balanceCents={invoice.balanceCents}
              allowRefund={invoice.amountPaidCents > 0}
              onDone={close}
            />
          )}
        </FormDialog>
      )}
      {canEdit && !isVoid && (
        <ConfirmButton
          title={`Email ${invoice.number} to the client?`}
          description={
            invoice.hasEmail
              ? "They get a link to view and download the invoice."
              : "This client has no email address."
          }
          confirmLabel="Send"
          variant={invoice.status === "DRAFT" ? "default" : "outline"}
          size="default"
          disabled={!invoice.hasEmail || send.pending}
          onConfirm={() => send.run({ id: invoice.id })}
        >
          <Send /> {invoice.status === "DRAFT" ? "Send" : "Resend"}
        </ConfirmButton>
      )}
      <Button asChild variant="outline">
        <a href={`/api/pdf/invoice/${invoice.id}`} target="_blank" rel="noreferrer">
          <Download /> PDF
        </a>
      </Button>
      {editable && (
        <Button asChild variant="outline">
          <Link href={`/invoices/${invoice.id}/edit`}>
            <Pencil /> Edit
          </Link>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {invoice.status !== "DRAFT" && (
            <>
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard.writeText(publicUrl);
                  toast.success("Client link copied");
                }}
              >
                <Link2 /> Copy client link
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={publicUrl} target="_blank" rel="noreferrer">
                  <Link2 /> Open client view
                </a>
              </DropdownMenuItem>
            </>
          )}
          {canEdit && invoice.status === "DRAFT" && (
            <DropdownMenuItem onClick={() => void markSent.run({ id: invoice.id })}>
              <CheckCheck /> Mark as sent
            </DropdownMenuItem>
          )}
          {canEdit && !isVoid && invoice.status !== "DRAFT" && invoice.creditableCents > 0 && (
            <DropdownMenuItem onClick={() => setDialog("credit")}>
              <FileMinus /> Issue credit note
            </DropdownMenuItem>
          )}
          {canEdit && !isVoid && invoice.amountPaidCents === 0 && (
            <DropdownMenuItem variant="destructive" onClick={() => setDialog("void")}>
              <Ban /> Void invoice
            </DropdownMenuItem>
          )}
          {canDelete && invoice.status === "DRAFT" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void remove.run({ id: invoice.id })}
              >
                <Trash2 /> Delete draft
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog
        title="Issue credit note"
        open={dialog === "credit"}
        onOpenChange={(o) => setDialog(o ? "credit" : null)}
      >
        {(close) => (
          <CreditNoteForm
            invoiceId={invoice.id}
            maxCents={invoice.creditableCents}
            onDone={close}
          />
        )}
      </FormDialog>
      <FormDialog
        title={`Void ${invoice.number}?`}
        description="A void invoice stays on record with a zero balance. This can't be undone."
        open={dialog === "void"}
        onOpenChange={(o) => setDialog(o ? "void" : null)}
      >
        {(close) => <VoidInvoiceForm invoiceId={invoice.id} onDone={close} />}
      </FormDialog>
    </>
  );
}
