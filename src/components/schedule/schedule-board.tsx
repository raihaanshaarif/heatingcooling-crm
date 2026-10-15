"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import type {
  DateSelectArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventSourceFuncArg,
} from "@fullcalendar/core";
import type { EventReceiveArg, EventResizeDoneArg } from "@fullcalendar/interaction";
import { GripVertical, Lock, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoutePicker } from "@/components/routes/route-picker";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/forms/form-dialog";
import { JobForm, type TechnicianOption } from "@/components/jobs/job-form";
import { JOB_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { TIMEZONE, fromMelbourneInput } from "@/lib/dates";
import { formatInTimeZone } from "date-fns-tz";
import { getScheduleEvents, rescheduleJob } from "@/server/jobs/actions";
import type { ClientOption } from "@/server/clients/queries";
import type { UnscheduledJob } from "@/server/jobs/queries";

type ScheduleEvent = Extract<
  Awaited<ReturnType<typeof getScheduleEvents>>,
  { ok: true }
>["data"][number];

const UNASSIGNED = "#64748b";

/*
 * The calendar runs in "UTC" holding Melbourne wall-clock times, so it shows
 * Melbourne hours whatever the viewer's device time zone is. These convert
 * between real instants and those wall-clock dates.
 */
const toWall = (instant: Date | string) =>
  formatInTimeZone(instant, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss") + "Z";
const fromWall = (wall: Date) => fromMelbourneInput(wall.toISOString().slice(0, 19));

/**
 * Dispatch board: week / day time grid coloured by technician. Select a slot to
 * create a job, drag or resize to reschedule, and drag unscheduled jobs in from
 * the sidebar.
 */
export function ScheduleBoard({
  technicians,
  clients,
  unscheduled,
  canEdit,
  canPlanRoutes = false,
}: {
  technicians: TechnicianOption[];
  clients: ClientOption[];
  unscheduled: UnscheduledJob[];
  canEdit: boolean;
  canPlanRoutes?: boolean;
}) {
  const router = useRouter();
  const calendar = useRef<FullCalendar>(null);
  const sidebar = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [slot, setSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [routeDay, setRouteDay] = useState<string | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  useEffect(() => {
    calendar.current?.getApi().refetchEvents();
  }, [hidden]);

  useEffect(() => {
    if (!sidebar.current || !canEdit) return;
    const draggable = new Draggable(sidebar.current, {
      itemSelector: "[data-job-id]",
      eventData: (el) => ({
        id: el.getAttribute("data-job-id") ?? undefined,
        title: el.getAttribute("data-title") ?? "",
        duration: { minutes: Number(el.getAttribute("data-minutes")) || 120 },
        create: true,
      }),
    });
    return () => draggable.destroy();
  }, [canEdit]);

  const fetchEvents = useCallback(
    async (info: EventSourceFuncArg): Promise<EventInput[]> => {
      const result = await getScheduleEvents({
        start: fromWall(info.start).toISOString(),
        end: fromWall(info.end).toISOString(),
      });
      if (!result.ok) {
        toast.error(result.error);
        return [];
      }
      return result.data
        .filter((e) =>
          e.technicians.length === 0
            ? !hiddenRef.current.includes("unassigned")
            : e.technicians.some((t) => !hiddenRef.current.includes(t.id)),
        )
        .map((e) => {
          const color = e.technicians[0]?.color ?? UNASSIGNED;
          const done = ["COMPLETED", "INVOICED"].includes(e.status);
          return {
            id: e.id,
            title: e.title,
            start: toWall(e.start),
            end: toWall(e.end),
            backgroundColor: done ? `color-mix(in oklch, ${color} 45%, white)` : color,
            borderColor: color,
            editable: canEdit && !done,
            extendedProps: e,
          };
        });
    },
    [canEdit],
  );

  const move = async (id: string, start: Date | null, end: Date | null, revert: () => void) => {
    if (!start) return revert();
    const result = await rescheduleJob({
      id,
      start: fromWall(start),
      end: fromWall(end ?? new Date(start.getTime() + 2 * 3600_000)),
    });
    if (!result.ok) {
      toast.error(result.error);
      revert();
    } else {
      toast.success("Job rescheduled");
      router.refresh();
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
      <Card className="min-w-0 py-4">
        <CardContent className="space-y-3 px-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            {canPlanRoutes && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="order-last ml-auto"
                onClick={() => {
                  // The calendar holds Melbourne wall-clock dates in "UTC": its date is the day shown.
                  const shown = calendar.current?.getApi().getDate();
                  setRouteDay(
                    shown ? shown.toISOString().slice(0, 10) : toWall(new Date()).slice(0, 10),
                  );
                }}
              >
                <Route /> Plan route
              </Button>
            )}
            <span className="text-muted-foreground text-sm">Show:</span>
            {[...technicians, { value: "unassigned", label: "Unassigned", color: UNASSIGNED }].map(
              (t) => {
                const off = hidden.includes(t.value);
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() =>
                      setHidden((h) => (off ? h.filter((x) => x !== t.value) : [...h, t.value]))
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
                      off && "opacity-40",
                    )}
                    aria-pressed={!off}
                  >
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.label}
                  </button>
                );
              },
            )}
          </div>
          <div className="schedule-calendar">
            <FullCalendar
              ref={calendar}
              plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
              initialView={
                typeof window !== "undefined" && window.innerWidth < 768
                  ? "timeGridDay"
                  : "timeGridWeek"
              }
              headerToolbar={{
                left: "prev,next today",
                center: "title",
                right: "timeGridWeek,timeGridDay,dayGridMonth",
              }}
              buttonText={{ today: "Today", week: "Week", day: "Day", month: "Month" }}
              firstDay={1}
              slotMinTime="06:00:00"
              slotMaxTime="20:00:00"
              scrollTime="07:00:00"
              businessHours={{
                daysOfWeek: [1, 2, 3, 4, 5, 6],
                startTime: "07:00",
                endTime: "17:30",
              }}
              allDaySlot={false}
              nowIndicator
              timeZone="UTC"
              now={() => toWall(new Date())}
              height="auto"
              expandRows
              slotDuration="00:30:00"
              snapDuration="00:15:00"
              eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
              selectable={canEdit}
              selectMirror
              editable={canEdit}
              droppable={canEdit}
              events={fetchEvents}
              select={(arg: DateSelectArg) => {
                setSlot({ start: fromWall(arg.start), end: fromWall(arg.end) });
                arg.view.calendar.unselect();
              }}
              eventClick={(arg: EventClickArg) => {
                arg.jsEvent.preventDefault();
                router.push(`/jobs/${arg.event.id}`);
              }}
              eventDrop={(arg: EventDropArg) =>
                void move(arg.event.id, arg.event.start, arg.event.end, arg.revert)
              }
              eventResize={(arg: EventResizeDoneArg) =>
                void move(arg.event.id, arg.event.start, arg.event.end, arg.revert)
              }
              eventReceive={(arg: EventReceiveArg) => {
                const { id } = arg.event;
                const start = arg.event.start;
                const end = arg.event.end;
                arg.event.remove();
                void move(id, start, end, () => undefined).then(() =>
                  calendar.current?.getApi().refetchEvents(),
                );
              }}
              eventContent={(arg: EventContentArg) => {
                const e = arg.event.extendedProps as ScheduleEvent;
                return (
                  <div className="h-full overflow-hidden px-1 py-0.5 text-[11px] leading-tight text-white">
                    <p className="font-semibold">
                      {arg.timeText} · {e.number}
                      {e.timeFixed && (
                        <Lock className="ml-1 inline size-2.5" aria-label="Time fixed" />
                      )}
                    </p>
                    <p className="truncate">
                      {e.clientName}
                      {e.suburb ? `, ${e.suburb}` : ""}
                    </p>
                    <p className="truncate opacity-90">{arg.event.title}</p>
                    {e.status !== "SCHEDULED" && (
                      <p className="truncate opacity-90">{JOB_STATUS_LABELS[e.status]}</p>
                    )}
                  </div>
                );
              }}
            />
          </div>
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Unscheduled ({unscheduled.length})</CardTitle>
          <p className="text-muted-foreground text-xs">
            {canEdit ? "Drag a job onto the calendar to book it." : "Jobs waiting for a time."}
          </p>
        </CardHeader>
        <CardContent>
          <div ref={sidebar} className="space-y-2">
            {unscheduled.length === 0 && (
              <p className="text-muted-foreground text-sm">Nothing waiting. Nice.</p>
            )}
            {unscheduled.map((j) => (
              <div
                key={j.id}
                data-job-id={j.id}
                data-title={j.title}
                data-minutes={j.estimatedMinutes}
                className={cn(
                  "bg-card flex gap-2 rounded-md border p-2 text-sm",
                  canEdit && "cursor-grab active:cursor-grabbing",
                )}
              >
                {canEdit && (
                  <GripVertical className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                )}
                <div className="min-w-0">
                  <a href={`/jobs/${j.id}`} className="font-medium hover:underline">
                    {j.number}
                  </a>{" "}
                  {j.priority !== "NORMAL" && j.priority !== "LOW" && (
                    <Badge variant={j.priority === "EMERGENCY" ? "destructive" : "warning"}>
                      {PRIORITY_LABELS[j.priority]}
                    </Badge>
                  )}
                  <p className="truncate">{j.title}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {j.clientName}
                    {j.suburb ? ` · ${j.suburb}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <FormDialog
        open={routeDay !== null}
        onOpenChange={(o) => !o && setRouteDay(null)}
        title="Plan route"
        description="Put a technician's jobs for the day in the order with the least driving."
      >
        {(close) =>
          routeDay && (
            <RoutePicker
              technicians={technicians}
              technicianId={technicians.find((t) => !hidden.includes(t.value))?.value}
              day={routeDay}
              onDone={close}
            />
          )
        }
      </FormDialog>
      <FormDialog
        open={slot !== null}
        onOpenChange={(o) => !o && setSlot(null)}
        title="New job"
        wide
      >
        {(close) =>
          slot && (
            <JobForm
              clients={clients}
              technicians={technicians}
              defaults={{ scheduledStart: slot.start, scheduledEnd: slot.end }}
              navigate={false}
              onDone={() => {
                close();
                calendar.current?.getApi().refetchEvents();
              }}
            />
          )
        }
      </FormDialog>
    </div>
  );
}
