"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  CircleDot,
  CreditCard,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  StickyNote,
} from "lucide-react";
import type { EntityType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/forms/use-action";
import { formatDateTime } from "@/lib/dates";
import { addNote } from "@/server/activity/actions";

export interface TimelineItem {
  id: string;
  type: string;
  entityType: EntityType;
  body: string;
  userName: string | null;
  createdAt: Date;
}

const ICONS: Record<string, typeof StickyNote> = {
  NOTE: StickyNote,
  CALL: Phone,
  EMAIL: Mail,
  SMS: MessageSquare,
  STATUS_CHANGE: RefreshCw,
  SYSTEM: CircleDot,
  PAYMENT: CreditCard,
};

const ENTITY_LABEL: Partial<Record<EntityType, string>> = {
  LEAD: "Lead",
  QUOTE: "Quote",
  JOB: "Job",
  INVOICE: "Invoice",
  CLIENT: "Client",
};

export function Timeline({ items, showEntity }: { items: TimelineItem[]; showEntity?: boolean }) {
  if (items.length === 0) return <p className="text-muted-foreground text-sm">No activity yet.</p>;
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {items.map((item) => {
        const Icon = ICONS[item.type] ?? CircleDot;
        return (
          <li key={item.id} className="relative">
            <span className="bg-background absolute top-0.5 -left-[29px] flex size-[18px] items-center justify-center rounded-full border">
              <Icon className="text-muted-foreground size-2.5" />
            </span>
            <p className="text-sm whitespace-pre-line">{item.body}</p>
            <p className="text-muted-foreground text-xs">
              {formatDateTime(item.createdAt)}
              {item.userName ? ` · ${item.userName}` : ""}
              {showEntity && ENTITY_LABEL[item.entityType]
                ? ` · ${ENTITY_LABEL[item.entityType]}`
                : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function NoteForm({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const pathname = usePathname();
  const [body, setBody] = useState("");
  const [type, setType] = useState<"NOTE" | "CALL" | "EMAIL" | "SMS">("NOTE");
  const action = useAction(addNote, { successMessage: "Note added", onSuccess: () => setBody("") });
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) void action.run({ entityType, entityId, type, body, path: pathname });
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note or log a call…"
        rows={2}
        aria-label="Note"
      />
      <div className="flex items-center justify-end gap-2">
        <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
          <SelectTrigger size="sm" className="w-32" aria-label="Note type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NOTE">Note</SelectItem>
            <SelectItem value="CALL">Phone call</SelectItem>
            <SelectItem value="EMAIL">Email</SelectItem>
            <SelectItem value="SMS">SMS</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={action.pending || !body.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
}
