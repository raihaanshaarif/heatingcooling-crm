/* eslint-disable @next/next/no-img-element -- logo comes from our own storage route */
import type { BusinessSettingsRecord } from "@/server/settings";
import { formatAddress } from "@/lib/utils";

export function BusinessHeader({ settings }: { settings: BusinessSettingsRecord }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {settings.logoUrl && (
          <img
            src={settings.logoUrl}
            alt={settings.businessName}
            className="mb-2 max-h-14 w-auto"
          />
        )}
        <p className="text-lg font-semibold text-sky-600">{settings.businessName}</p>
        {settings.abn && <p className="text-muted-foreground text-sm">ABN {settings.abn}</p>}
      </div>
      <div className="text-muted-foreground text-right text-sm">
        {settings.phone && <p>{settings.phone}</p>}
        {settings.email && <p>{settings.email}</p>}
        <p>{formatAddress(settings)}</p>
      </div>
    </div>
  );
}
