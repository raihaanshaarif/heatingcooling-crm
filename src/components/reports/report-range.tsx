"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ReportRange({
  from,
  to,
  presets,
}: {
  from: string;
  to: string;
  presets: { label: string; from: string; to: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [, setRange] = useQueryStates(
    { from: parseAsString, to: parseAsString },
    { shallow: false, history: "replace", startTransition },
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <Button
          key={p.label}
          size="sm"
          variant={p.from === from && p.to === to ? "default" : "outline"}
          onClick={() => void setRange({ from: p.from, to: p.to })}
        >
          {p.label}
        </Button>
      ))}
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label="From"
          className="h-8 w-[140px]"
          value={from}
          onChange={(e) => e.target.value && void setRange({ from: e.target.value })}
        />
        <span className="text-muted-foreground text-xs">to</span>
        <Input
          type="date"
          aria-label="To"
          className="h-8 w-[140px]"
          value={to}
          onChange={(e) => e.target.value && void setRange({ to: e.target.value })}
        />
      </div>
      {pending && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
    </div>
  );
}
