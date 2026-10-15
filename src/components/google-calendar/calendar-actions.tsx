"use client";

import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { useAction } from "@/components/forms/use-action";
import {
  disconnectMyGoogleCalendar,
  resyncMyCalendar,
  retryFailedCalendarTasks,
} from "@/server/google-calendar/actions";

export function ConnectGoogleCalendarButton({
  label = "Connect Google Calendar",
  variant = "default",
}: {
  label?: string;
  variant?: "default" | "outline";
}) {
  return (
    <Button asChild size="sm" variant={variant}>
      {/* A full page navigation: the route redirects to Google's consent screen. */}
      <a href="/api/integrations/google/connect" data-testid="google-connect">
        <CalendarPlus />
        {label}
      </a>
    </Button>
  );
}

export function ResyncCalendarButton() {
  const router = useRouter();
  const resync = useAction(resyncMyCalendar, {
    onSuccess: (d) => {
      if (d.failed) toast.error(d.message);
      else toast.success(d.message);
      router.refresh();
    },
  });
  return (
    <Button size="sm" variant="outline" onClick={() => resync.run({})} disabled={resync.pending}>
      {resync.pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      Resync my calendar
    </Button>
  );
}

export function DisconnectGoogleCalendarButton({ email }: { email: string | null }) {
  const router = useRouter();
  const disconnect = useAction(disconnectMyGoogleCalendar, {
    successMessage: (d) => d.message,
    onSuccess: () => router.refresh(),
  });
  return (
    <ConfirmButton
      title="Disconnect Google Calendar?"
      description={`Your upcoming CoolOps jobs are removed from ${email ?? "your Google calendar"} (past ones stay), CoolOps stops adding new ones and the access you gave CoolOps is revoked at Google.`}
      confirmLabel="Disconnect"
      destructive
      variant="ghost"
      onConfirm={() => disconnect.run({ removeEvents: true })}
    >
      <Unplug />
      Disconnect
    </ConfirmButton>
  );
}

export function RetryFailedCalendarButton() {
  const router = useRouter();
  const retry = useAction(retryFailedCalendarTasks, {
    successMessage: (d) => d.message,
    onSuccess: () => router.refresh(),
  });
  return (
    <Button size="sm" variant="outline" onClick={() => retry.run({})} disabled={retry.pending}>
      {retry.pending && <Loader2 className="animate-spin" />}
      Retry failed
    </Button>
  );
}
