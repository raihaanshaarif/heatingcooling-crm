import { CalendarCheck, CalendarX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CalendarBadge as State } from "@/server/google-calendar/queries";

const LABELS: Record<State, string> = {
  connected: "Calendar connected",
  error: "Calendar error",
  reconnect: "Calendar needs reconnecting",
};

export function CalendarBadge({ state }: { state: State }) {
  const ok = state === "connected";
  return (
    <Badge variant={ok ? "success" : "warning"} title={LABELS[state]} data-testid="calendar-badge">
      {ok ? <CalendarCheck /> : <CalendarX />}
      {LABELS[state]}
    </Badge>
  );
}
