import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
  tone?: "default" | "danger" | "success";
}) {
  const body = (
    <Card className={cn("gap-0 py-4 transition-colors", href && "hover:bg-muted/40")}>
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-sm">{label}</p>
          <p
            className={cn(
              "text-2xl font-semibold tabular-nums",
              tone === "danger" && "text-destructive",
              tone === "success" && "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {value}
          </p>
          {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
        </div>
        {Icon && (
          <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Icon className="text-muted-foreground size-4.5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
