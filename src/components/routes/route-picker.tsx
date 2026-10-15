"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface RouteTechnician {
  value: string;
  label: string;
  color?: string;
  hint?: string;
}

export function routeHref(technicianId: string, day: string) {
  return `/schedule/route?tech=${encodeURIComponent(technicianId)}&date=${day}`;
}

/** Choose a technician and a day, then open the route planner for them. */
export function RoutePicker({
  technicians,
  technicianId,
  day,
  onDone,
  compact,
}: {
  technicians: RouteTechnician[];
  technicianId?: string | null;
  day: string;
  onDone?: () => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tech, setTech] = useState(technicianId ?? technicians[0]?.value ?? "");
  const [date, setDate] = useState(day);
  const go = (t = tech, d = date) => {
    if (!t || !d) return;
    start(() => {
      router.push(routeHref(t, d));
      onDone?.();
    });
  };
  return (
    <div className={compact ? "flex flex-wrap items-end gap-2" : "grid gap-4 sm:grid-cols-2"}>
      <div className="grid gap-1.5">
        <Label htmlFor="route-tech">Technician</Label>
        <Select
          value={tech}
          onValueChange={(v) => {
            setTech(v);
            if (compact) go(v, date);
          }}
        >
          <SelectTrigger id="route-tech" className={compact ? "w-48" : "w-full"}>
            <SelectValue placeholder="Choose a technician" />
          </SelectTrigger>
          <SelectContent>
            {technicians.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                <span className="inline-flex items-center gap-2">
                  {t.color && (
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                  )}
                  {t.label}
                  {t.hint && <span className="text-muted-foreground text-xs">{t.hint}</span>}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="route-date">Day</Label>
        <Input
          id="route-date"
          type="date"
          value={date}
          className={compact ? "w-40" : undefined}
          onChange={(e) => {
            setDate(e.target.value);
            if (compact && e.target.value) go(tech, e.target.value);
          }}
        />
      </div>
      {compact ? (
        pending && <Loader2 className="text-muted-foreground mb-2 size-4 animate-spin" />
      ) : (
        <div className="flex justify-end sm:col-span-2">
          <Button type="button" onClick={() => go()} disabled={!tech || !date || pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Route />} Plan route
          </Button>
        </div>
      )}
    </div>
  );
}
