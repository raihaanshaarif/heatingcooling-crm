"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import {
  formatDateTime,
  formatMinutes,
  formatTime,
  minutesBetween,
  toDateTimeInput,
} from "@/lib/dates";
import { addTimeEntry, deleteTimeEntry, stopTimeEntry } from "@/server/jobs/actions";

export interface TimeEntryRow {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  minutes: number | null;
  note: string | null;
  user: { id: string; name: string };
}

export function JobTimeEntries({
  jobId,
  entries,
  people,
  currentUserId,
  canManageOthers,
}: {
  jobId: string;
  entries: TimeEntryRow[];
  people: { value: string; label: string }[];
  currentUserId: string;
  canManageOthers: boolean;
}) {
  const router = useRouter();
  const stop = useAction(stopTimeEntry, {
    successMessage: "Timer stopped",
    onSuccess: () => router.refresh(),
  });
  const remove = useAction(deleteTimeEntry, { onSuccess: () => router.refresh() });
  const total = entries.reduce(
    (s, e) => s + (e.minutes ?? (e.endedAt ? 0 : minutesBetween(e.startedAt, new Date()))),
    0,
  );
  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No time logged. Starting the job starts a timer automatically.
        </p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {entries.map((e) => {
            const mine = e.user.id === currentUserId;
            return (
              <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{e.user.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatDateTime(e.startedAt)} – {e.endedAt ? formatTime(e.endedAt) : "running"}
                    {e.note && ` · ${e.note}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="tabular-nums">
                    {e.endedAt ? (
                      formatMinutes(e.minutes)
                    ) : (
                      <span className="text-emerald-600">● Live</span>
                    )}
                  </span>
                  {!e.endedAt && (mine || canManageOthers) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void stop.run({ id: e.id })}
                      aria-label="Stop timer"
                    >
                      <Square />
                    </Button>
                  )}
                  {(mine || canManageOthers) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void remove.run({ id: e.id })}
                      aria-label="Delete entry"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between">
        <FormDialog
          title="Log time"
          trigger={
            <Button variant="outline" size="sm">
              <Plus /> Log time
            </Button>
          }
        >
          {(close) => (
            <TimeEntryForm
              jobId={jobId}
              people={canManageOthers ? people : []}
              defaultUserId={currentUserId}
              onDone={close}
            />
          )}
        </FormDialog>
        <span className="text-muted-foreground text-sm">Total {formatMinutes(total)}</span>
      </div>
    </div>
  );
}

function TimeEntryForm({
  jobId,
  people,
  defaultUserId,
  onDone,
}: {
  jobId: string;
  people: { value: string; label: string }[];
  defaultUserId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const now = new Date();
  const [userId, setUserId] = useState(
    people.some((p) => p.value === defaultUserId)
      ? defaultUserId
      : (people[0]?.value ?? defaultUserId),
  );
  const [startedAt, setStartedAt] = useState(toDateTimeInput(new Date(now.getTime() - 3600_000)));
  const [endedAt, setEndedAt] = useState(toDateTimeInput(now));
  const [note, setNote] = useState("");
  const action = useAction(addTimeEntry, {
    successMessage: "Time logged",
    onSuccess: () => {
      onDone();
      router.refresh();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run({ jobId, userId, startedAt, endedAt, note });
      }}
    >
      {people.length > 0 && (
        <div className="space-y-2">
          <Label>Who</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {people.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="te-start">Start</Label>
          <Input
            id="te-start"
            type="datetime-local"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="te-end">End</Label>
          <Input
            id="te-end"
            type="datetime-local"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="te-note">Note</Label>
        <Input
          id="te-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={action.pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
