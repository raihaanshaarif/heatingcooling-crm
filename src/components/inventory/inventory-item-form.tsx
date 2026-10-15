"use client";

import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import { SelectField, SwitchField, TextField, type SelectOption } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { inventoryItemSchema, type InventoryItemInput } from "@/lib/validations/inventory";
import { saveInventoryItem } from "@/server/inventory/actions";
import type { StockRow } from "@/server/inventory/queries";

/** Start tracking a price book part, or edit its reorder level and supplier. */
export function InventoryItemForm({
  item,
  untracked = [],
  suppliers,
  onDone,
}: {
  item?: StockRow;
  untracked?: SelectOption[];
  suppliers: SelectOption[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const form = useZodForm(inventoryItemSchema, {
    defaultValues: {
      priceBookItemId: item?.priceBookItemId ?? "",
      reorderLevel: item ? String(item.reorderLevel) : "2",
      supplierId: item?.supplierId ?? null,
      supplierSku: item?.supplierSku ?? "",
      active: item?.active ?? true,
    },
  });
  const action = useAction((v: InventoryItemInput) => saveInventoryItem(item?.id ?? null, v), {
    successMessage: item ? "Item saved" : "Now tracking this item",
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
        {item ? (
          <p className="text-sm font-medium">
            {item.name}
            {item.sku && <span className="text-muted-foreground"> · {item.sku}</span>}
          </p>
        ) : (
          <SelectField
            name="priceBookItemId"
            label="Price book item"
            options={untracked}
            placeholder={untracked.length ? "Choose a part" : "Every part is already tracked"}
            description="Only parts and equipment can be stocked. Add new parts in the Price book first."
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="reorderLevel"
            label={`Reorder level${item && item.unit !== "each" ? ` (${item.unit})` : ""}`}
            inputMode="decimal"
            description="Flagged as low stock when the total across the warehouse and vans drops below this. 0 = never."
          />
          <SelectField name="supplierId" label="Usual supplier" options={suppliers} allowEmpty />
          <TextField name="supplierSku" label="Supplier's part number" />
        </div>
        {item && (
          <SwitchField
            name="active"
            label="Tracked"
            description="Untracked items are no longer deducted when used on jobs."
          />
        )}
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>{item ? "Save" : "Track item"}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
