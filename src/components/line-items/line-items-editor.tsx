"use client";

import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { dollarsToCents, formatCents, lineTotalCents } from "@/lib/money";
import type { PriceBookPickerItem } from "@/server/price-book/queries";
import { PriceBookPicker } from "./price-book-picker";
import { LineTotals, type EditableLine } from "./line-totals";

export interface LineDraft {
  priceBookItemId?: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost?: string;
  taxable: boolean;
}

export function lineFromPriceBook(item: PriceBookPickerItem): LineDraft {
  return {
    priceBookItemId: item.id,
    description: item.description ? `${item.name} – ${item.description}` : item.name,
    quantity: "1",
    unitPrice: (item.priceCents / 100).toFixed(2),
    unitCost: (item.costCents / 100).toFixed(2),
    taxable: item.taxable,
  };
}

export const EMPTY_LINE: LineDraft = {
  priceBookItemId: null,
  description: "",
  quantity: "1",
  unitPrice: "",
  taxable: true,
};

/**
 * Editable table of line items bound to a react-hook-form array at `name`
 * (e.g. "lines" or "options.0.lines"). Shows live totals with GST.
 */
export function LineItemsEditor({
  name,
  priceBook,
  gstRegistered,
  withCost = false,
}: {
  name: string;
  priceBook: PriceBookPickerItem[];
  gstRegistered: boolean;
  withCost?: boolean;
}) {
  const { control, register, setValue, formState } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name });
  const lines = useWatch({ control, name }) as EditableLine[] | undefined;
  const arrayError = name
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc as Record<string, unknown> | undefined)?.[key],
      formState.errors,
    ) as { message?: string; root?: { message?: string } } | undefined;

  return (
    <div className="space-y-3">
      <div className="text-muted-foreground hidden grid-cols-[1fr_80px_110px_60px_100px_36px] gap-2 px-1 text-xs font-medium md:grid">
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit (ex GST)</span>
        <span className="text-center">GST</span>
        <span className="text-right">Amount</span>
        <span />
      </div>
      {fields.map((field, index) => {
        const line = lines?.[index];
        const cents = dollarsToCents(line?.unitPrice ?? 0);
        const total = lineTotalCents(
          Number(line?.quantity) || 0,
          Number.isFinite(cents) ? cents : 0,
        );
        const rowErrors = (
          arrayError as Record<number, Record<string, { message?: string }>> | undefined
        )?.[index];
        return (
          <div
            key={field.id}
            className="grid grid-cols-[1fr_auto] gap-2 rounded-md border p-2 md:grid-cols-[1fr_80px_110px_60px_100px_36px] md:items-start md:border-0 md:p-0"
          >
            <div className="col-span-2 md:col-span-1">
              <Input
                {...register(`${name}.${index}.description`)}
                placeholder="Description"
                aria-label="Description"
                aria-invalid={!!rowErrors?.description}
              />
              {rowErrors?.description?.message && (
                <p className="text-destructive mt-1 text-xs">{rowErrors.description.message}</p>
              )}
            </div>
            <Input
              {...register(`${name}.${index}.quantity`)}
              inputMode="decimal"
              className="text-right"
              aria-label="Quantity"
              aria-invalid={!!rowErrors?.quantity}
            />
            <div className="relative">
              <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">
                $
              </span>
              <Input
                {...register(`${name}.${index}.unitPrice`)}
                inputMode="decimal"
                className="pl-6 text-right"
                aria-label="Unit price"
                aria-invalid={!!rowErrors?.unitPrice}
              />
            </div>
            <label className="flex h-9 items-center justify-center gap-1.5 text-xs md:justify-center">
              <Checkbox
                checked={line?.taxable ?? true}
                onCheckedChange={(v) =>
                  setValue(`${name}.${index}.taxable`, v === true, { shouldDirty: true })
                }
                aria-label="GST applies"
              />
              <span className="md:sr-only">GST</span>
            </label>
            <p className="flex h-9 items-center justify-end text-sm font-medium tabular-nums">
              {formatCents(total)}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(index)}
              aria-label="Remove line"
            >
              <Trash2 />
            </Button>
            {withCost && (
              <div className="col-span-2 flex items-center gap-2 md:col-span-6">
                <span className="text-muted-foreground text-xs">Unit cost $</span>
                <Input
                  {...register(`${name}.${index}.unitCost`)}
                  inputMode="decimal"
                  className="h-7 w-24 text-right text-xs"
                  aria-label="Unit cost"
                />
              </div>
            )}
          </div>
        );
      })}
      {arrayError?.message && <p className="text-destructive text-sm">{arrayError.message}</p>}
      {arrayError?.root?.message && (
        <p className="text-destructive text-sm">{arrayError.root.message}</p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <PriceBookPicker items={priceBook} onPick={(item) => append(lineFromPriceBook(item))} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ ...EMPTY_LINE })}
          >
            <Plus /> Custom line
          </Button>
        </div>
        <LineTotals lines={lines} gstRegistered={gstRegistered} />
      </div>
    </div>
  );
}
