"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, Phone } from "lucide-react";
import type { LeadStatus } from "@prisma/client";
import { toast } from "sonner";
import { PriorityBadge } from "@/components/shared/status-badge";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, SERVICE_CATEGORY_LABELS } from "@/lib/labels";
import { formatCents, sumCents } from "@/lib/money";
import { relativeDays } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { updateLeadStatus } from "@/server/leads/actions";
import type { LeadRow } from "@/server/leads/queries";
import { MarkLostDialog } from "./mark-lost-dialog";

const STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "SITE_VISIT_BOOKED", "QUOTED", "WON", "LOST"];
const COLUMN_ACCENT: Record<LeadStatus, string> = {
  NEW: "bg-sky-500",
  CONTACTED: "bg-zinc-400",
  SITE_VISIT_BOOKED: "bg-violet-500",
  QUOTED: "bg-amber-500",
  WON: "bg-emerald-500",
  LOST: "bg-zinc-300 dark:bg-zinc-600",
};

function LeadCard({ lead, dragging }: { lead: LeadRow; dragging?: boolean }) {
  return (
    <div
      className={cn(
        "bg-card rounded-md border p-3 text-sm shadow-xs",
        dragging && "ring-primary rotate-1 shadow-lg ring-2",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/leads/${lead.id}`}
          className="font-medium hover:underline"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {lead.name}
        </Link>
        <PriorityBadge priority={lead.urgency} />
      </div>
      <p className="text-muted-foreground text-xs">
        {[lead.suburb, lead.serviceCategory ? SERVICE_CATEGORY_LABELS[lead.serviceCategory] : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>
          {LEAD_SOURCE_LABELS[lead.source]}
          {lead.sourceDetail ? ` · ${lead.sourceDetail}` : ""}
        </span>
        {lead.estimatedValueCents ? (
          <span className="text-foreground font-medium">
            {formatCents(lead.estimatedValueCents)}
          </span>
        ) : null}
        {lead.phone && (
          <span className="inline-flex items-center gap-1">
            <Phone className="size-3" />
            {lead.phone}
          </span>
        )}
        {lead.followUpAt && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              lead.followUpAt.getTime() < Date.now() && "text-destructive",
            )}
          >
            <CalendarClock className="size-3" />
            {relativeDays(lead.followUpAt)}
          </span>
        )}
      </div>
    </div>
  );
}

function DraggableLead({ lead }: { lead: LeadRow }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { status: lead.status },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("cursor-grab touch-none active:cursor-grabbing", isDragging && "opacity-40")}
      aria-label={`Lead ${lead.name}, ${LEAD_STATUS_LABELS[lead.status]}. Press space to move.`}
      {...listeners}
      {...attributes}
    >
      <LeadCard lead={lead} />
    </div>
  );
}

function Column({ status, leads }: { status: LeadStatus; leads: LeadRow[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const total = sumCents(leads.map((l) => l.estimatedValueCents ?? 0));
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "bg-muted/40 flex w-72 shrink-0 flex-col rounded-lg border transition-colors",
        isOver && "border-primary bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", COLUMN_ACCENT[status])} />
          <span className="text-sm font-medium">{LEAD_STATUS_LABELS[status]}</span>
          <span className="text-muted-foreground text-xs">{leads.length}</span>
        </div>
        {total > 0 && <span className="text-muted-foreground text-xs">{formatCents(total)}</span>}
      </div>
      <div
        className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2"
        style={{ maxHeight: "calc(100dvh - 280px)" }}
      >
        {leads.map((lead) => (
          <DraggableLead key={lead.id} lead={lead} />
        ))}
        {leads.length === 0 && (
          <p className="text-muted-foreground p-3 text-center text-xs">Drop leads here</p>
        )}
      </div>
    </div>
  );
}

export function LeadsKanban({ data }: { data: LeadRow[] }) {
  const router = useRouter();
  const [leads, setLeads] = useState(data);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [losing, setLosing] = useState<{ id: string; previous: LeadStatus } | null>(null);
  useEffect(() => setLeads(data), [data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const move = (id: string, status: LeadStatus) =>
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));

  const onDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const id = String(event.active.id);
    const to = event.over?.id as LeadStatus | undefined;
    const lead = leads.find((l) => l.id === id);
    if (!lead || !to || lead.status === to) return;
    const previous = lead.status;
    move(id, to);
    if (to === "LOST") {
      setLosing({ id, previous });
      return;
    }
    const result = await updateLeadStatus({ id, status: to });
    if (!result.ok) {
      move(id, previous);
      toast.error(result.error);
    } else {
      toast.success(`Moved to ${LEAD_STATUS_LABELS[to]}`);
      router.refresh();
    }
  };

  const active = activeId ? leads.find((l) => l.id === activeId) : null;
  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={(e) => void onDragEnd(e)}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STATUSES.map((status) => (
            <Column key={status} status={status} leads={leads.filter((l) => l.status === status)} />
          ))}
        </div>
        <DragOverlay>{active ? <LeadCard lead={active} dragging /> : null}</DragOverlay>
      </DndContext>
      {losing && (
        <MarkLostDialog
          leadId={losing.id}
          open
          onOpenChange={(open) => {
            if (!open) {
              move(losing.id, losing.previous);
              setLosing(null);
            }
          }}
          onDone={() => setLosing(null)}
        />
      )}
    </>
  );
}
