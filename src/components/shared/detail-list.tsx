import { cn } from "@/lib/utils";

/** Two-column label / value list for detail pages. Empty values are hidden. */
export function DetailList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode; hidden?: boolean }[];
  className?: string;
}) {
  const visible = items.filter(
    (i) => !i.hidden && i.value !== null && i.value !== undefined && i.value !== "",
  );
  return (
    <dl
      className={cn(
        "grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(110px,auto)_1fr]",
        className,
      )}
    >
      {visible.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words whitespace-pre-line">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
