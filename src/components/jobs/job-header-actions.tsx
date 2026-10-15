"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarX, ChevronDown, MoreHorizontal, Pencil, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormDialog } from "@/components/forms/form-dialog";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { useAction } from "@/components/forms/use-action";
import { createInvoiceFromJob } from "@/server/invoices/actions";
import { deleteJob, unscheduleJob } from "@/server/jobs/actions";
import type { ClientOption } from "@/server/clients/queries";
import type { JobDetail } from "@/server/jobs/queries";
import { JobForm, type TechnicianOption } from "./job-form";

export function JobHeaderActions({
  job,
  clients,
  technicians,
  canEdit,
  canInvoice,
  canDelete,
}: {
  job: JobDetail;
  clients: ClientOption[];
  technicians: TechnicianOption[];
  canEdit: boolean;
  canInvoice: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [partial, setPartial] = useState<null | "deposit" | "progress">(null);
  const [percent, setPercent] = useState("30");
  const invoice = useAction(createInvoiceFromJob, {
    successMessage: "Invoice created",
    onSuccess: (d) => router.push(`/invoices/${d.id}`),
  });
  const unschedule = useAction(unscheduleJob, {
    successMessage: "Removed from schedule",
    onSuccess: () => router.refresh(),
  });
  const remove = useAction(deleteJob, {
    successMessage: "Job deleted",
    onSuccess: () => router.push("/jobs"),
  });
  const invoiceable = canInvoice && !["INVOICED", "CANCELLED"].includes(job.status);
  const movable = !["COMPLETED", "INVOICED", "CANCELLED"].includes(job.status);

  return (
    <>
      {canEdit && (
        <FormDialog
          title={`Edit ${job.number}`}
          wide
          trigger={
            <Button variant="outline">
              <Pencil /> Edit
            </Button>
          }
        >
          {(close) => (
            <JobForm job={job} clients={clients} technicians={technicians} onDone={close} />
          )}
        </FormDialog>
      )}
      {invoiceable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={job.status === "COMPLETED" ? "default" : "outline"}
              disabled={invoice.pending}
            >
              <Receipt /> Create invoice <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void invoice.run({ jobId: job.id, kind: "full" })}>
              Invoice the job in full
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPartial("deposit")}>
              Deposit invoice…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPartial("progress")}>
              Progress claim…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {(canEdit || canDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && movable && job.scheduledStart && (
              <DropdownMenuItem onSelect={() => void unschedule.run({ id: job.id })}>
                <CalendarX /> Unschedule
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <div className="p-1">
                  <ConfirmButton
                    title={`Delete ${job.number}?`}
                    description="The job is hidden everywhere. Jobs with invoices can't be deleted."
                    confirmLabel="Delete job"
                    destructive
                    variant="ghost"
                    className="text-destructive w-full justify-start"
                    onConfirm={() => remove.run({ id: job.id })}
                  >
                    <Trash2 /> Delete job
                  </ConfirmButton>
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog open={partial !== null} onOpenChange={(o) => !o && setPartial(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {partial === "deposit" ? "Deposit invoice" : "Progress claim"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pct">Percentage of the job value</Label>
            <Input
              id="pct"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              inputMode="numeric"
              className="w-32"
            />
            <p className="text-muted-foreground text-xs">
              The final invoice deducts deposits and progress claims automatically.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartial(null)}>
              Cancel
            </Button>
            <Button
              disabled={invoice.pending}
              onClick={() =>
                partial &&
                void invoice.run({ jobId: job.id, kind: partial, percent: Number(percent) })
              }
            >
              Create invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
