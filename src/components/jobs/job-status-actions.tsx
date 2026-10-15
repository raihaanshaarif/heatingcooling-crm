"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JobStatus } from "@prisma/client";
import { Car, CheckCircle2, ChevronDown, PauseCircle, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/forms/use-action";
import { JOB_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { updateJobStatus } from "@/server/jobs/actions";

const NEXT_STEPS: Partial<
  Record<JobStatus, { status: JobStatus; label: string; icon: typeof Car }[]>
> = {
  SCHEDULED: [
    { status: "EN_ROUTE", label: "On my way", icon: Car },
    { status: "IN_PROGRESS", label: "Start job", icon: PlayCircle },
  ],
  EN_ROUTE: [{ status: "IN_PROGRESS", label: "Start job", icon: PlayCircle }],
  IN_PROGRESS: [
    { status: "COMPLETED", label: "Complete", icon: CheckCircle2 },
    { status: "ON_HOLD", label: "On hold", icon: PauseCircle },
  ],
  ON_HOLD: [{ status: "IN_PROGRESS", label: "Resume", icon: PlayCircle }],
};

const TECH_STATUSES: JobStatus[] = ["SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "ON_HOLD", "COMPLETED"];

/**
 * The job's next-step buttons (On my way → Start → Complete) plus, for the office,
 * a menu to set any status. `large` renders the big mobile buttons for My Jobs.
 */
export function JobStatusActions({
  jobId,
  status,
  isTechnician,
  large,
  onCompleted,
}: {
  jobId: string;
  status: JobStatus;
  isTechnician?: boolean;
  large?: boolean;
  onCompleted?: () => void;
}) {
  const router = useRouter();
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = useAction(updateJobStatus, {
    successMessage: (d) =>
      `Job ${JOB_STATUS_LABELS[d.status].toLowerCase()}${d.sms ? `. ${d.sms}` : ""}`,
    onSuccess: (d) => {
      setHoldOpen(false);
      setReason("");
      if (d.status === "COMPLETED") onCompleted?.();
      router.refresh();
    },
  });
  const set = (next: JobStatus) => {
    if (next === "ON_HOLD") setHoldOpen(true);
    else void action.run({ id: jobId, status: next });
  };
  const steps = NEXT_STEPS[status] ?? [];
  const menuStatuses = (Object.keys(JOB_STATUS_LABELS) as JobStatus[]).filter(
    (s) =>
      s !== status &&
      (!isTechnician || TECH_STATUSES.includes(s)) &&
      (s !== "INVOICED" || isTechnician === false),
  );

  return (
    <>
      <div className={cn("flex flex-wrap gap-2", large && "grid grid-cols-1 sm:grid-cols-2")}>
        {steps.map((s, i) => (
          <Button
            key={s.status}
            size={large ? "xl" : "default"}
            variant={i === 0 ? "default" : "outline"}
            disabled={action.pending}
            onClick={() => set(s.status)}
            className={cn(
              large && "w-full",
              large && s.status === "COMPLETED" && "bg-emerald-600 text-white hover:bg-emerald-700",
            )}
          >
            <s.icon /> {s.label}
          </Button>
        ))}
        {!large && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={action.pending}>
                Status <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Set status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {menuStatuses
                .filter((s) => s !== "INVOICED")
                .map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => set(s)}>
                    {JOB_STATUS_LABELS[s]}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Dialog open={holdOpen} onOpenChange={setHoldOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Put job on hold</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="hold-reason">Reason</Label>
            <Textarea
              id="hold-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Waiting on parts, customer not home…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!reason.trim() || action.pending}
              onClick={() =>
                void action.run({ id: jobId, status: "ON_HOLD", onHoldReason: reason })
              }
            >
              Put on hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
