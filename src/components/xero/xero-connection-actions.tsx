"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { useAction } from "@/components/forms/use-action";
import {
  chooseXeroTenant,
  disconnectXeroAction,
  retryAllFailedXero,
  syncXeroNow,
} from "@/server/xero/actions";

export function SyncNowButton({ size = "sm" }: { size?: "sm" | "default" }) {
  const router = useRouter();
  const sync = useAction(syncXeroNow, {
    successMessage: (d) => d.message,
    onSuccess: () => router.refresh(),
  });
  return (
    <Button size={size} onClick={() => sync.run({})} disabled={sync.pending}>
      {sync.pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      Sync now
    </Button>
  );
}

export function RetryAllFailedButton() {
  const router = useRouter();
  const retry = useAction(retryAllFailedXero, {
    successMessage: (d) => d.message,
    onSuccess: () => router.refresh(),
  });
  return (
    <Button size="sm" variant="outline" onClick={() => retry.run({})} disabled={retry.pending}>
      {retry.pending && <Loader2 className="animate-spin" />}
      Retry all failed
    </Button>
  );
}

export function DisconnectXeroButton({ tenantName }: { tenantName: string | null }) {
  const router = useRouter();
  const disconnect = useAction(disconnectXeroAction, {
    successMessage: (d) => d.message,
    onSuccess: () => router.refresh(),
  });
  return (
    <ConfirmButton
      title="Disconnect Xero?"
      description={`CoolOps stops sending invoices and payments${tenantName ? ` to ${tenantName}` : ""}, and the access Xero gave CoolOps is revoked. Nothing already in Xero is changed. Records remember their Xero links, so reconnecting the same organisation carries on where it left off.`}
      confirmLabel="Disconnect"
      destructive
      variant="ghost"
      onConfirm={() => disconnect.run({})}
    >
      <Unplug />
      Disconnect
    </ConfirmButton>
  );
}

export function ChooseOrganisation({
  tenants,
}: {
  tenants: { tenantId: string; tenantName: string }[];
}) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string>("");
  const choose = useAction(chooseXeroTenant, {
    successMessage: (d) => `Connected to ${d.tenantName}`,
    onSuccess: () => router.refresh(),
  });
  return (
    <span className="mt-2 flex flex-wrap items-center gap-2">
      <Select value={tenantId} onValueChange={setTenantId}>
        <SelectTrigger className="w-64" aria-label="Xero organisation">
          <SelectValue placeholder="Choose the organisation" />
        </SelectTrigger>
        <SelectContent>
          {tenants.map((t) => (
            <SelectItem key={t.tenantId} value={t.tenantId}>
              {t.tenantName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={!tenantId || choose.pending}
        onClick={() => choose.run({ tenantId })}
      >
        {choose.pending && <Loader2 className="animate-spin" />}
        Use this organisation
      </Button>
    </span>
  );
}

export function ConnectXeroButton({ label = "Connect to Xero" }: { label?: string }) {
  return (
    <Button asChild size="sm">
      {/* A full page navigation: the route redirects to Xero's sign-in. */}
      <a href="/api/integrations/xero/connect">{label}</a>
    </Button>
  );
}

export function XeroLinks() {
  return (
    <>
      <Button asChild size="sm" variant="outline">
        <Link href="/settings?tab=xero">Settings</Link>
      </Button>
      <Button asChild size="sm" variant="ghost">
        <Link href="/settings?tab=xero-log">Sync log</Link>
      </Button>
    </>
  );
}
