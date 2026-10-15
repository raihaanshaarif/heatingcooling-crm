"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/forms/use-action";
import { cn } from "@/lib/utils";
import {
  addChecklistItem,
  applyChecklistTemplate,
  toggleChecklistItem,
} from "@/server/jobs/actions";

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  note: string | null;
}

export function JobChecklist({
  jobId,
  items,
  readOnly,
  large,
}: {
  jobId: string;
  items: ChecklistItem[];
  readOnly?: boolean;
  large?: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const toggle = useAction(toggleChecklistItem, { onSuccess: () => router.refresh() });
  const add = useAction(addChecklistItem, {
    onSuccess: () => {
      setLabel("");
      router.refresh();
    },
  });
  const apply = useAction(applyChecklistTemplate, {
    successMessage: (d) => `${d.added} checklist items added`,
    onSuccess: () => router.refresh(),
  });
  const done = items.filter((i) => optimistic[i.id] ?? i.checked).length;

  return (
    <div className="space-y-3">
      {items.length > 0 ? (
        <>
          <div className="flex items-center gap-3">
            <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${(done / items.length) * 100}%` }}
              />
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">
              {done}/{items.length}
            </span>
          </div>
          <ul className="space-y-1">
            {items.map((item) => {
              const checked = optimistic[item.id] ?? item.checked;
              return (
                <li key={item.id}>
                  <label
                    className={cn(
                      "hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-md px-2",
                      large ? "py-3 text-base" : "py-1.5 text-sm",
                    )}
                  >
                    <Checkbox
                      className={cn(large && "size-6")}
                      checked={checked}
                      disabled={readOnly}
                      onCheckedChange={(v) => {
                        setOptimistic((o) => ({ ...o, [item.id]: v === true }));
                        void toggle.run({ itemId: item.id, checked: v === true });
                      }}
                    />
                    <span className={cn(checked && "text-muted-foreground line-through")}>
                      {item.label}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground text-sm">No checklist on this job yet.</p>
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              disabled={apply.pending}
              onClick={() => void apply.run({ id: jobId })}
            >
              <ListChecks /> Add template checklist
            </Button>
          )}
        </div>
      )}
      {!readOnly && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) void add.run({ jobId, label });
          }}
        >
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Add a checklist item"
            aria-label="New checklist item"
          />
          <Button
            type="submit"
            variant="outline"
            size="icon"
            disabled={add.pending || !label.trim()}
            aria-label="Add item"
          >
            <Plus />
          </Button>
        </form>
      )}
    </div>
  );
}
