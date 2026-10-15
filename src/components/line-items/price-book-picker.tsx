"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ITEM_TYPE_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import type { PriceBookPickerItem } from "@/server/price-book/queries";

/** Searchable price book popover. Calls onPick with the chosen item. */
export function PriceBookPicker({
  items,
  onPick,
  label = "Add from price book",
  hidePrices = false,
}: {
  items: PriceBookPickerItem[];
  onPick: (item: PriceBookPickerItem) => void;
  label?: string;
  /** Technicians pick parts without seeing sell prices. */
  hidePrices?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const groups = (Object.keys(ITEM_TYPE_LABELS) as (keyof typeof ITEM_TYPE_LABELS)[])
    .map((type) => ({ type, items: items.filter((i) => i.type === type) }))
    .filter((g) => g.items.length > 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <BookOpen /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search services, parts, units…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No items found.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.type} heading={ITEM_TYPE_LABELS[g.type]}>
                {g.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.sku ?? ""}`}
                    onSelect={() => {
                      onPick(item);
                      setOpen(false);
                    }}
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="truncate">{item.name}</span>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {hidePrices ? item.unit : `${formatCents(item.priceCents)}/${item.unit}`}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
