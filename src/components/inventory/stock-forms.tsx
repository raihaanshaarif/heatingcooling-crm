"use client";

import { useRouter } from "next/navigation";
import { useFieldArray } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  CheckboxField,
  MoneyField,
  SelectField,
  TextField,
  TextareaField,
  type SelectOption,
} from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { formatQty } from "@/lib/inventory";
import { STOCK_ADJUST_REASONS } from "@/lib/labels";
import {
  adjustStockSchema,
  receiveStockSchema,
  transferStockSchema,
  type AdjustStockInput,
  type ReceiveStockInput,
  type TransferStockInput,
} from "@/lib/validations/inventory";
import { adjustStock, receiveStock, transferStock } from "@/server/inventory/actions";
import type { LocationOption, StockItemOption } from "@/server/inventory/queries";

/** Quantity on hand per item per location: levels[itemId][locationId]. */
export type LevelMap = Record<string, Record<string, number>>;

const locationOptions = (locations: LocationOption[], activeOnly = true) =>
  locations.filter((l) => !activeOnly || l.active).map((l) => ({ value: l.id, label: l.name }));

const itemOptions = (items: StockItemOption[]) =>
  items.map((i) => ({ value: i.value, label: i.sku ? `${i.label} (${i.sku})` : i.label }));

function OnHand({
  itemId,
  locationId,
  items,
  levels,
}: {
  itemId: string | undefined;
  locationId: string | null | undefined;
  items: StockItemOption[];
  levels: LevelMap;
}) {
  if (!itemId || !locationId) return null;
  const item = items.find((i) => i.value === itemId);
  const qty = levels[itemId]?.[locationId] ?? 0;
  return (
    <p className={qty < 0 ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
      On hand: {formatQty(qty, item?.unit)}
    </p>
  );
}

// ─── Receive ────────────────────────────────────────────────────────────────

export function ReceiveStockForm({
  items,
  locations,
  suppliers,
  showCosts,
  canUpdateCostPrice,
  defaultItemId,
  onDone,
}: {
  items: StockItemOption[];
  locations: LocationOption[];
  suppliers: SelectOption[];
  showCosts: boolean;
  canUpdateCostPrice: boolean;
  defaultItemId?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const warehouse = locations.find((l) => l.type === "WAREHOUSE");
  const first = items.find((i) => i.value === defaultItemId);
  const blankLine = (itemId = "") => {
    const item = items.find((i) => i.value === itemId);
    return {
      inventoryItemId: itemId,
      quantity: "1",
      unitCost: showCosts && item ? (item.costCents / 100).toFixed(2) : "",
    };
  };
  const form = useZodForm(receiveStockSchema, {
    defaultValues: {
      supplierId: first?.supplierId ?? null,
      locationId: warehouse?.id ?? "",
      reference: "",
      notes: "",
      updateCostPrice: false,
      lines: [blankLine(defaultItemId)],
    },
  });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const action = useAction((v: ReceiveStockInput) => receiveStock(v), {
    successMessage: (d) => `Received ${d.lines} item${d.lines === 1 ? "" : "s"}`,
    onSuccess: () => {
      onDone?.();
      router.refresh();
    },
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            name="supplierId"
            label="Supplier"
            options={suppliers}
            allowEmpty
            emptyLabel="No supplier"
          />
          <SelectField
            name="locationId"
            label="Receive into"
            options={locationOptions(locations)}
          />
          <TextField name="reference" label="Invoice / docket no." />
        </div>
        <div className="space-y-3">
          {lines.fields.map((field, i) => (
            <div
              key={field.id}
              className="grid items-start gap-3 rounded-md border p-3 sm:grid-cols-[1fr_7rem_8rem_auto]"
            >
              <SelectField
                name={`lines.${i}.inventoryItemId`}
                label="Item"
                options={itemOptions(items)}
                placeholder="Choose an item"
                onValueChange={(id) => {
                  const item = items.find((x) => x.value === id);
                  if (showCosts && item)
                    form.setValue(`lines.${i}.unitCost`, (item.costCents / 100).toFixed(2));
                }}
              />
              <TextField name={`lines.${i}.quantity`} label="Qty" inputMode="decimal" />
              {showCosts ? (
                <MoneyField name={`lines.${i}.unitCost`} label="Unit cost (ex GST)" />
              ) : (
                <span className="hidden sm:block" />
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="sm:mt-6"
                aria-label="Remove line"
                disabled={lines.fields.length === 1}
                onClick={() => lines.remove(i)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => lines.append(blankLine())}
          >
            <Plus /> Add item
          </Button>
          {form.formState.errors.lines?.root?.message && (
            <p className="text-destructive text-sm">{form.formState.errors.lines.root.message}</p>
          )}
        </div>
        <TextareaField name="notes" label="Notes" rows={2} />
        {showCosts && canUpdateCostPrice && (
          <CheckboxField
            name="updateCostPrice"
            label="Update the price book cost price to what we paid"
            description="Keeps job margins accurate when supplier prices change."
          />
        )}
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Receive stock</SubmitButton>
        </div>
      </form>
    </Form>
  );
}

// ─── Transfer ───────────────────────────────────────────────────────────────

export function TransferStockForm({
  items,
  locations,
  levels,
  defaultFromId,
  defaultToId,
  defaultItemId,
  onDone,
}: {
  items: StockItemOption[];
  locations: LocationOption[];
  levels: LevelMap;
  defaultFromId?: string;
  defaultToId?: string;
  defaultItemId?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const warehouse = locations.find((l) => l.type === "WAREHOUSE");
  const fromId = defaultFromId ?? warehouse?.id ?? "";
  const toId =
    defaultToId ?? locations.find((l) => l.active && l.id !== fromId && l.type === "VAN")?.id ?? "";
  const form = useZodForm(transferStockSchema, {
    defaultValues: {
      fromLocationId: fromId,
      toLocationId: toId,
      note: "",
      lines: [{ inventoryItemId: defaultItemId ?? "", quantity: "1" }],
    },
  });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const from = form.watch("fromLocationId");
  const watchedLines = form.watch("lines");
  const action = useAction((v: TransferStockInput) => transferStock(v), {
    successMessage: (d) => (d.negative.length ? "" : "Stock moved"),
    onSuccess: (d) => {
      if (d.negative.length)
        toast.warning(`Stock moved. Now negative: ${d.negative.join("; ")}. Check the count.`);
      onDone?.();
      router.refresh();
    },
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            name="fromLocationId"
            label="From"
            options={locationOptions(locations, false)}
          />
          <SelectField name="toLocationId" label="To" options={locationOptions(locations)} />
        </div>
        <div className="space-y-3">
          {lines.fields.map((field, i) => (
            <div
              key={field.id}
              className="grid items-start gap-3 rounded-md border p-3 sm:grid-cols-[1fr_7rem_auto]"
            >
              <div className="space-y-1">
                <SelectField
                  name={`lines.${i}.inventoryItemId`}
                  label="Item"
                  options={itemOptions(items)}
                  placeholder="Choose an item"
                />
                <OnHand
                  itemId={watchedLines[i]?.inventoryItemId}
                  locationId={from}
                  items={items}
                  levels={levels}
                />
              </div>
              <TextField name={`lines.${i}.quantity`} label="Qty" inputMode="decimal" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="sm:mt-6"
                aria-label="Remove line"
                disabled={lines.fields.length === 1}
                onClick={() => lines.remove(i)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => lines.append({ inventoryItemId: "", quantity: "1" })}
          >
            <Plus /> Add item
          </Button>
        </div>
        <TextField name="note" label="Note" placeholder="e.g. Restock before Monday's installs" />
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Move stock</SubmitButton>
        </div>
      </form>
    </Form>
  );
}

// ─── Adjust / stocktake ─────────────────────────────────────────────────────

export function AdjustStockForm({
  items,
  locations,
  levels,
  defaultItemId,
  defaultLocationId,
  onDone,
}: {
  items: StockItemOption[];
  locations: LocationOption[];
  levels: LevelMap;
  defaultItemId?: string;
  defaultLocationId?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(adjustStockSchema, {
    defaultValues: {
      inventoryItemId: defaultItemId ?? "",
      locationId: defaultLocationId ?? locations.find((l) => l.type === "WAREHOUSE")?.id ?? "",
      mode: "set",
      quantity: "",
      reason: STOCK_ADJUST_REASONS[0],
      note: "",
    },
  });
  const [itemId, locationId, mode] = form.watch(["inventoryItemId", "locationId", "mode"]);
  const item = items.find((i) => i.value === itemId);
  const current = itemId && locationId ? (levels[itemId]?.[locationId] ?? 0) : null;
  const action = useAction((v: AdjustStockInput) => adjustStock(v), {
    successMessage: (d) =>
      d.changed ? `Stock is now ${formatQty(d.quantity, item?.unit)}` : "No change needed",
    onSuccess: () => {
      onDone?.();
      router.refresh();
    },
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            name="inventoryItemId"
            label="Item"
            options={itemOptions(items)}
            placeholder="Choose an item"
          />
          <SelectField
            name="locationId"
            label="Location"
            options={locationOptions(locations, false)}
          />
          <SelectField
            name="mode"
            label="Change"
            options={[
              { value: "set", label: "Set to counted quantity" },
              { value: "add", label: "Add" },
              { value: "remove", label: "Remove" },
            ]}
          />
          <TextField
            name="quantity"
            label={mode === "set" ? "Counted quantity" : "Quantity"}
            inputMode="decimal"
            description={
              current === null ? undefined : `Currently ${formatQty(current, item?.unit)} here.`
            }
          />
          <SelectField
            name="reason"
            label="Reason"
            options={STOCK_ADJUST_REASONS.map((r) => ({ value: r, label: r }))}
          />
          <TextField name="note" label="Note" placeholder="Optional detail" />
        </div>
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>Save adjustment</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
