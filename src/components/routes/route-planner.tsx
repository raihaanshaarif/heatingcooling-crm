"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Check, ExternalLink, Lock, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { useAction } from "@/components/forms/use-action";
import { formatDateTime, formatMinutes, formatTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { applyRoutePlan, undoRoutePlan } from "@/server/routes/actions";

export interface RouteRowView {
  jobId: string;
  number: string;
  title: string;
  clientName: string;
  address: string;
  fixedLabel: string | null;
  currentPosition: number;
  proposedPosition: number;
  currentStart: Date;
  currentEnd: Date;
  proposedStart: Date;
  proposedEnd: Date;
  changed: boolean;
  currentTravel: { minutes: number; km: number };
  proposedTravel: { minutes: number; km: number };
  waitMinutes: number;
  lateMinutes: number;
}

export interface LastAppliedView {
  id: string;
  appliedAt: Date;
  appliedBy: string | null;
  undoneAt: Date | null;
  jobs: number;
  savingKm: number;
  savingMinutes: number;
}

const km = (n: number) => `${n.toFixed(1)} km`;

export function RoutePlanner({
  technicianId,
  technicianName,
  day,
  provider,
  before,
  after,
  rows,
  returnTravel,
  mapsUrls,
  lastApplied,
}: {
  technicianId: string;
  technicianName: string;
  day: string;
  provider: "google" | "estimate";
  before: { km: number; minutes: number };
  after: { km: number; minutes: number };
  rows: RouteRowView[];
  returnTravel: { minutes: number; km: number };
  mapsUrls: string[];
  lastApplied: LastAppliedView | null;
}) {
  const router = useRouter();
  const changed = rows.filter((r) => r.changed);
  const apply = useAction(applyRoutePlan, {
    successMessage: (d) => `${d.changed} job${d.changed === 1 ? "" : "s"} rescheduled`,
    onSuccess: () => router.refresh(),
  });
  const undo = useAction(undoRoutePlan, {
    successMessage: (d) =>
      `${d.restored.length} job${d.restored.length === 1 ? "" : "s"} put back${d.skipped.length ? ` (${d.skipped.join(", ")} moved since, left as is)` : ""}`,
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ConfirmButton
          variant="default"
          size="default"
          disabled={!changed.length || apply.pending}
          title={`Apply new times for ${technicianName}?`}
          description={`${changed.length} job${changed.length === 1 ? "" : "s"} will be rescheduled (Schedule board, ${technicianName}'s calendar and the job timelines are updated). You can undo it afterwards.`}
          confirmLabel="Apply new times"
          onConfirm={() =>
            apply.run({
              technicianId,
              day,
              provider,
              before,
              after,
              jobs: changed.map((r) => ({
                id: r.jobId,
                from: r.currentStart,
                start: r.proposedStart,
                end: r.proposedEnd,
              })),
            })
          }
        >
          <Check /> Apply new times
        </ConfirmButton>
        {mapsUrls.map((url, i) => (
          <Button key={url} asChild variant="outline">
            <a href={url} target="_blank" rel="noopener noreferrer" data-testid="maps-link">
              <ExternalLink /> Open in Google Maps
              {mapsUrls.length > 1 ? ` (part ${i + 1} of ${mapsUrls.length})` : ""}
            </a>
          </Button>
        ))}
        {!changed.length && (
          <span className="text-muted-foreground text-sm">
            Nothing to change: the booked times already match the plan.
          </span>
        )}
      </div>

      {lastApplied && (
        <div
          className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
          data-testid="last-applied"
        >
          <span>
            {lastApplied.undoneAt ? (
              <>
                Route plan applied {formatDateTime(lastApplied.appliedAt)} was{" "}
                <strong>undone</strong> {formatDateTime(lastApplied.undoneAt)}.
              </>
            ) : (
              <>
                Route plan applied {formatDateTime(lastApplied.appliedAt)}
                {lastApplied.appliedBy ? ` by ${lastApplied.appliedBy}` : ""}: {lastApplied.jobs}{" "}
                job
                {lastApplied.jobs === 1 ? "" : "s"} moved, saving{" "}
                {km(Math.max(0, lastApplied.savingKm))} and{" "}
                {formatMinutes(Math.max(0, lastApplied.savingMinutes))} of driving.
              </>
            )}
          </span>
          {!lastApplied.undoneAt && (
            <ConfirmButton
              title="Undo the route plan?"
              description="Puts the jobs back to the times they had before. Jobs moved again since are left as they are."
              confirmLabel="Undo"
              disabled={undo.pending}
              onConfirm={() => undo.run({ id: lastApplied.id })}
            >
              <Undo2 /> Undo
            </ConfirmButton>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table data-testid="route-stops">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>Current time</TableHead>
              <TableHead>Proposed time</TableHead>
              <TableHead className="text-right">Drive to it</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.jobId}
                data-job={r.number}
                className={cn(r.changed && "bg-primary/5")}
              >
                <TableCell className="font-semibold tabular-nums">
                  {r.proposedPosition}
                  {r.currentPosition !== r.proposedPosition && (
                    <span className="text-muted-foreground block text-[10px] font-normal">
                      was {r.currentPosition}
                    </span>
                  )}
                </TableCell>
                <TableCell className="min-w-56">
                  <a href={`/jobs/${r.jobId}`} className="font-medium hover:underline">
                    {r.number}
                  </a>{" "}
                  <span className="text-muted-foreground">· {r.clientName}</span>
                  {r.fixedLabel && (
                    <Badge variant="destructive" className="ml-1.5">
                      <Lock className="size-3" /> {r.fixedLabel}
                    </Badge>
                  )}
                  <p className="text-muted-foreground text-xs">{r.title}</p>
                  <p className="text-muted-foreground text-xs">{r.address}</p>
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatTime(r.currentStart)} – {formatTime(r.currentEnd)}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums" data-testid="proposed-time">
                  <span className={cn(r.changed && "text-primary font-semibold")}>
                    {r.changed && <ArrowRight className="mr-1 inline size-3.5" />}
                    {formatTime(r.proposedStart)} – {formatTime(r.proposedEnd)}
                  </span>
                  {r.lateMinutes > 0 && (
                    <span className="text-destructive block text-xs">
                      Can&apos;t get there in time: {formatMinutes(r.lateMinutes)} late
                    </span>
                  )}
                  {r.waitMinutes >= 15 && r.lateMinutes === 0 && (
                    <span className="text-muted-foreground block text-xs">
                      {formatMinutes(r.waitMinutes)} free before
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs whitespace-nowrap tabular-nums">
                  <span className="font-medium">
                    {formatMinutes(r.proposedTravel.minutes)} · {km(r.proposedTravel.km)}
                  </span>
                  <span className="text-muted-foreground block">
                    now {formatMinutes(r.currentTravel.minutes)} · {km(r.currentTravel.km)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell />
              <TableCell colSpan={3} className="text-muted-foreground text-sm">
                Drive back to the start
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {formatMinutes(returnTravel.minutes)} · {km(returnTravel.km)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
