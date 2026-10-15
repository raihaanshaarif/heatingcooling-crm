"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useTransition } from "react";
import { Input } from "@/components/ui/input";

/** From / to date filter stored in the URL. Triggers a server re-render (shallow: false). */
export function DateRangeFilter({ label = "Created" }: { label?: string }) {
  const [pending, startTransition] = useTransition();
  const [{ from, to }, setRange] = useQueryStates(
    { from: parseAsString.withDefault(""), to: parseAsString.withDefault("") },
    { shallow: false, history: "replace", startTransition },
  );
  return (
    <div className="flex items-center gap-1.5" aria-busy={pending}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <Input
        type="date"
        aria-label={`${label} from`}
        className="h-8 w-[140px]"
        value={from}
        onChange={(e) => void setRange({ from: e.target.value || null })}
      />
      <span className="text-muted-foreground text-xs">to</span>
      <Input
        type="date"
        aria-label={`${label} to`}
        className="h-8 w-[140px]"
        value={to}
        onChange={(e) => void setRange({ to: e.target.value || null })}
      />
    </div>
  );
}
