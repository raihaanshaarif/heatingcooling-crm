import { CalendarDays } from "lucide-react";
import { formatDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MyCalendarStatus } from "@/server/google-calendar/queries";
import {
  ConnectGoogleCalendarButton,
  DisconnectGoogleCalendarButton,
  ResyncCalendarButton,
} from "./calendar-actions";

/** My account → Google Calendar. */
export function MyCalendarCard({ status }: { status: MyCalendarStatus }) {
  const conn = status.connection;
  return (
    <Card data-testid="google-calendar-card">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="text-muted-foreground size-5" />
          <CardTitle>Google Calendar</CardTitle>
        </div>
        {!status.configured ? (
          <Badge variant="muted">Not set up</Badge>
        ) : !conn ? (
          <Badge variant="warning">Not connected</Badge>
        ) : conn.state === "connected" ? (
          <Badge variant="success">Connected</Badge>
        ) : (
          <Badge variant="warning">
            {conn.state === "reconnect" ? "Reconnect needed" : "Problem"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <CardDescription>
          Jobs you&apos;re assigned to appear in your own Google Calendar (on your phone too), with
          the client&apos;s phone, address and access notes, and move when the office reschedules
          them. One way only: changes made in Google don&apos;t come back to CoolOps.
        </CardDescription>
        {!status.configured && (
          <p className="text-muted-foreground" data-testid="google-not-set-up">
            Google Calendar sync isn&apos;t set up for CoolOps yet. An admin turns it on from the
            Integrations page; then a Connect Google Calendar button appears here.
          </p>
        )}
        {status.configured && !conn && (
          <div className="flex flex-wrap gap-2">
            <ConnectGoogleCalendarButton />
          </div>
        )}
        {conn && (
          <>
            <p>
              Connected to{" "}
              <strong data-testid="google-email">
                {conn.googleEmail ?? "your Google account"}
              </strong>{" "}
              (main calendar).{" "}
              <span className="text-muted-foreground" data-testid="google-counts">
                {conn.upcoming} upcoming job{conn.upcoming === 1 ? "" : "s"} in your calendar
                {conn.pending > 0 &&
                  `, ${conn.pending} update${conn.pending === 1 ? "" : "s"} waiting`}
                {conn.failed > 0 && `, ${conn.failed} failed`}.{" "}
                {conn.lastSyncAt
                  ? `Last update ${formatDateTime(conn.lastSyncAt)}.`
                  : "Not synced yet."}
              </span>
            </p>
            {conn.lastError && (
              <p className="text-destructive" data-testid="google-error">
                {conn.lastError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {status.configured && conn.needsReconnect ? (
                <ConnectGoogleCalendarButton label="Reconnect Google Calendar" />
              ) : (
                status.configured && <ResyncCalendarButton />
              )}
              {status.configured && !conn.needsReconnect && (
                <ConnectGoogleCalendarButton label="Reconnect" variant="outline" />
              )}
              <DisconnectGoogleCalendarButton email={conn.googleEmail} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
