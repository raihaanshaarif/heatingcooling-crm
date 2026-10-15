"use client";

import { countSegments } from "@/lib/sms/segments";
import { cn } from "@/lib/utils";

/** Live "123 characters · 1 SMS" line under an SMS textarea. Providers bill per SMS segment. */
export function SmsCounter({ text, className }: { text: string; className?: string }) {
  const info = countSegments(text);
  return (
    <p
      className={cn("text-muted-foreground text-xs tabular-nums", className)}
      aria-live="polite"
      data-testid="sms-counter"
    >
      {info.length} character{info.length === 1 ? "" : "s"} ·{" "}
      <span className={cn(info.segments > 1 && "font-medium text-amber-700 dark:text-amber-400")}>
        {info.segments} SMS
      </span>
      {info.segments > 0 && ` · ${info.remaining} left in this SMS`}
      {info.encoding === "UCS-2" && (
        <span className="block text-amber-700 dark:text-amber-400">
          Contains {info.unicodeChars.slice(0, 5).join(" ")}, so each SMS holds only 70 characters.
          Remove emoji / special characters to fit 160.
        </span>
      )}
    </p>
  );
}
