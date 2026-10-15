"use client";

import { Columns3, Table2 } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import type { LeadRow } from "@/server/leads/queries";
import { LeadsKanban } from "./leads-kanban";
import { LeadsTable } from "./leads-table";

export function LeadsView({
  data,
  staff,
}: {
  data: LeadRow[];
  staff: { value: string; label: string }[];
}) {
  const [view, setView] = useQueryState(
    "view",
    parseAsStringLiteral(["table", "board"] as const).withDefault("table"),
  );
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="View">
        <Button
          size="sm"
          variant={view === "table" ? "secondary" : "ghost"}
          onClick={() => void setView("table")}
          aria-pressed={view === "table"}
        >
          <Table2 /> Table
        </Button>
        <Button
          size="sm"
          variant={view === "board" ? "secondary" : "ghost"}
          onClick={() => void setView("board")}
          aria-pressed={view === "board"}
        >
          <Columns3 /> Pipeline
        </Button>
      </div>
      {view === "board" ? <LeadsKanban data={data} /> : <LeadsTable data={data} staff={staff} />}
    </div>
  );
}
