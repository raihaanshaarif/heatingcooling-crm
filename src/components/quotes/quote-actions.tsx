"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Download,
  Link2,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { QuoteStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import { formatCents } from "@/lib/money";
import {
  acceptQuote,
  createJobFromQuote,
  declineQuote,
  deleteQuote,
  duplicateQuote,
  sendQuote,
} from "@/server/quotes/actions";

export function QuoteActions({
  quote,
  publicUrl,
  canEdit,
  canDelete,
  canCreateJob,
}: {
  quote: {
    id: string;
    number: string;
    status: QuoteStatus;
    hasEmail: boolean;
    options: { id: string; name: string; totalCents: number }[];
    jobId: string | null;
  };
  publicUrl: string;
  canEdit: boolean;
  canDelete: boolean;
  canCreateJob: boolean;
}) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [optionId, setOptionId] = useState(quote.options[0]?.id ?? "");
  const refresh = () => router.refresh();
  const send = useAction(sendQuote, {
    successMessage: (d) =>
      d.skipped ? "Marked as sent (email not configured, logged to console)" : "Quote emailed",
    onSuccess: refresh,
  });
  const accept = useAction(acceptQuote, {
    successMessage: "Quote accepted",
    onSuccess: () => {
      setAccepting(false);
      refresh();
    },
  });
  const decline = useAction(declineQuote, { successMessage: "Quote declined", onSuccess: refresh });
  const duplicate = useAction(duplicateQuote, {
    successMessage: "Quote duplicated",
    onSuccess: (d) => router.push(`/quotes/${d.id}/edit`),
  });
  const remove = useAction(deleteQuote, {
    successMessage: "Quote deleted",
    onSuccess: () => router.push("/quotes"),
  });
  const makeJob = useAction(createJobFromQuote, {
    successMessage: "Job created",
    onSuccess: (d) => router.push(`/jobs/${d.id}`),
  });
  const decided = quote.status === "ACCEPTED" || quote.status === "DECLINED";

  return (
    <>
      {quote.status === "ACCEPTED" && canCreateJob && !quote.jobId && (
        <Button onClick={() => void makeJob.run({ id: quote.id })} disabled={makeJob.pending}>
          <Wrench /> Create job
        </Button>
      )}
      {quote.jobId && (
        <Button asChild variant="outline">
          <Link href={`/jobs/${quote.jobId}`}>
            <Wrench /> View job
          </Link>
        </Button>
      )}
      {canEdit && !decided && (
        <ConfirmButton
          title={`Email ${quote.number} to the client?`}
          description={
            quote.hasEmail
              ? "They get a link to view the options and accept online."
              : "This client has no email address."
          }
          confirmLabel="Send"
          variant={quote.status === "DRAFT" ? "default" : "outline"}
          size="default"
          disabled={!quote.hasEmail || send.pending}
          onConfirm={() => send.run({ id: quote.id })}
        >
          <Send /> {quote.status === "DRAFT" ? "Send" : "Resend"}
        </ConfirmButton>
      )}
      <Button asChild variant="outline">
        <a href={`/api/pdf/quote/${quote.id}`} target="_blank" rel="noreferrer">
          <Download /> PDF
        </a>
      </Button>
      {canEdit && !decided && (
        <Button asChild variant="outline">
          <Link href={`/quotes/${quote.id}/edit`}>
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
          {canEdit && !decided && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAccepting(true)}>
                <Check /> Record acceptance
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void decline.run({ id: quote.id })}>
                <X /> Record decline
              </DropdownMenuItem>
            </>
          )}
          {canEdit && (
            <DropdownMenuItem onClick={() => void duplicate.run({ id: quote.id })}>
              <Copy /> Duplicate
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void remove.run({ id: quote.id })}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog
        title="Record acceptance"
        description="Which option did the client choose?"
        open={accepting}
        onOpenChange={setAccepting}
      >
        {() => (
          <div className="space-y-4">
            <div className="space-y-2" role="radiogroup" aria-label="Option">
              {quote.options.map((o) => (
                <Label
                  key={o.id}
                  className="hover:bg-muted flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 font-normal"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="option"
                      value={o.id}
                      checked={optionId === o.id}
                      onChange={() => setOptionId(o.id)}
                    />
                    {o.name}
                  </span>
                  <span className="tabular-nums">{formatCents(o.totalCents)}</span>
                </Label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => void accept.run({ id: quote.id, optionId })}
                disabled={accept.pending || !optionId}
              >
                Mark accepted
              </Button>
            </div>
          </div>
        )}
      </FormDialog>
    </>
  );
}
