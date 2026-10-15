"use client";

import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import {
  MoneyField,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { ITEM_TYPE_LABELS, SERVICE_CATEGORY_LABELS, options } from "@/lib/labels";
import { marginPercent, dollarsToCents } from "@/lib/money";
import { priceBookItemSchema, type PriceBookItemInput } from "@/lib/validations/price-book";
import { savePriceBookItem } from "@/server/price-book/actions";
import type { PriceBookRow } from "@/server/price-book/queries";

export function PriceBookForm({ item, onDone }: { item?: PriceBookRow; onDone?: () => void }) {
  const router = useRouter();
  const form = useZodForm(priceBookItemSchema, {
    defaultValues: {
      sku: item?.sku ?? "",
      name: item?.name ?? "",
      description: item?.description ?? "",
      type: item?.type ?? "PART",
      category: item?.category ?? "OTHER",
      unit: item?.unit ?? "each",
      cost: item?.costCents != null ? (item.costCents / 100).toFixed(2) : "",
      price: item ? (item.priceCents / 100).toFixed(2) : "",
      taxable: item?.taxable ?? true,
      active: item?.active ?? true,
    },
  });
  const [cost, price] = form.watch(["cost", "price"]);
  const margin = marginPercent(
    dollarsToCents(String(cost ?? "")) || 0,
    dollarsToCents(String(price ?? "")) || 0,
  );
  const action = useAction((v: PriceBookItemInput) => savePriceBookItem(item?.id ?? null, v), {
    successMessage: item ? "Item updated" : "Item added",
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
          <TextField name="name" label="Name" className="sm:col-span-2" />
          <TextField name="sku" label="SKU / code" />
          <TextField name="unit" label="Unit" placeholder="each, hour, kg, metre" />
          <SelectField name="type" label="Type" options={options(ITEM_TYPE_LABELS)} />
          <SelectField
            name="category"
            label="Category"
            options={options(SERVICE_CATEGORY_LABELS)}
          />
          <MoneyField name="cost" label="Cost price (ex GST)" />
          <MoneyField
            name="price"
            label="Sell price (ex GST)"
            description={margin !== null ? `Margin ${margin}%` : undefined}
          />
        </div>
        <TextareaField name="description" label="Description (shown on quotes)" rows={2} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SwitchField name="taxable" label="GST applies" />
          <SwitchField
            name="active"
            label="Active"
            description="Inactive items are hidden from pickers."
          />
        </div>
        <div className="flex justify-end">
          <SubmitButton pending={action.pending}>{item ? "Save item" : "Add item"}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
