"use client";

import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useFieldArray } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { SubmitButton } from "@/components/forms/submit-button";
import { useAction } from "@/components/forms/use-action";
import { useZodForm } from "@/components/forms/use-zod-form";
import { LineItemsEditor, EMPTY_LINE } from "@/components/line-items/line-items-editor";
import { toDateInput, addMelbourneDays } from "@/lib/dates";
import { quoteSchema, type QuoteInput } from "@/lib/validations/quotes";
import { createQuote, updateQuote } from "@/server/quotes/actions";
import type { ClientOption } from "@/server/clients/queries";
import type { PriceBookPickerItem } from "@/server/price-book/queries";
import type { QuoteDetail } from "@/server/quotes/queries";

const OPTION_NAMES = ["Good", "Better", "Best", "Option 4", "Option 5"];

export function QuoteBuilder({
  quote,
  clients,
  priceBook,
  gstRegistered,
  defaults,
}: {
  quote?: QuoteDetail;
  clients: ClientOption[];
  priceBook: PriceBookPickerItem[];
  gstRegistered: boolean;
  defaults: {
    clientId?: string;
    propertyId?: string;
    leadId?: string;
    terms: string;
    validityDays: number;
    title?: string;
  };
}) {
  const router = useRouter();
  const form = useZodForm(quoteSchema, {
    defaultValues: {
      clientId: quote?.clientId ?? defaults.clientId ?? "",
      propertyId: quote?.propertyId ?? defaults.propertyId ?? null,
      leadId: quote?.leadId ?? defaults.leadId ?? null,
      title: quote?.title ?? defaults.title ?? "",
      intro: quote?.intro ?? "",
      terms: quote?.terms ?? defaults.terms,
      validUntil: toDateInput(
        quote?.validUntil ?? addMelbourneDays(new Date(), defaults.validityDays),
      ),
      options: quote
        ? quote.options.map((o) => ({
            name: o.name,
            description: o.description ?? "",
            lines: o.lineItems.map((l) => ({
              priceBookItemId: l.priceBookItemId,
              description: l.description,
              quantity: String(l.quantity),
              unitPrice: (l.unitPriceCents / 100).toFixed(2),
              taxable: l.taxable,
            })),
          }))
        : [{ name: "Option 1", description: "", lines: [{ ...EMPTY_LINE }] }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "options" });
  const clientId = form.watch("clientId");
  const properties = clients.find((c) => c.id === clientId)?.properties ?? [];
  const selectedClient = clients.find((c) => c.id === clientId);

  const action = useAction((v: QuoteInput) => (quote ? updateQuote(quote.id, v) : createQuote(v)), {
    successMessage: quote ? "Quote saved" : "Quote created",
    onSuccess: (d) => router.push(`/quotes/${d.id}`),
  });

  const addOption = (copyFrom?: number) => {
    const values = form.getValues("options");
    const source = copyFrom !== undefined ? values[copyFrom] : undefined;
    if (values.length === 1 && values[0].name === "Option 1")
      form.setValue("options.0.name", OPTION_NAMES[0]);
    append({
      name: OPTION_NAMES[values.length] ?? `Option ${values.length + 1}`,
      description: source?.description ?? "",
      lines: source ? source.lines.map((l) => ({ ...l })) : [{ ...EMPTY_LINE }],
    });
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => action.run(form.getValues(), form))}
        className="space-y-6"
        noValidate
      >
        <Card>
          <CardHeader>
            <CardTitle>Quote details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <SelectField
              name="clientId"
              label="Client"
              options={clients.map((c) => ({
                value: c.id,
                label: c.doNotService ? `${c.name} ⚠ Do not service` : c.name,
              }))}
              onValueChange={(v) => {
                const props = clients.find((c) => c.id === v)?.properties ?? [];
                form.setValue("propertyId", props[0]?.id ?? null);
              }}
            />
            <SelectField
              name="propertyId"
              label="Site / property"
              options={properties.map((p) => ({ value: p.id, label: p.label }))}
              allowEmpty
              emptyLabel="No site address"
            />
            {selectedClient?.doNotService && (
              <p className="text-destructive text-sm md:col-span-2">
                This client is flagged “Do not service”. Check with the owner before quoting.
              </p>
            )}
            <TextField
              name="title"
              label="Title"
              placeholder="Supply and install 7.1kW split system"
              className="md:col-span-2"
            />
            <TextareaField
              name="intro"
              label="Introduction (shown above the options)"
              rows={3}
              className="md:col-span-2"
            />
            <TextField name="validUntil" label="Valid until" type="date" />
          </CardContent>
        </Card>

        {fields.map((field, index) => (
          <Card key={field.id}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Input
                  {...form.register(`options.${index}.name`)}
                  className="h-9 max-w-xs text-base font-semibold"
                  aria-label="Option name"
                />
                {fields.length > 1 && (
                  <span className="text-muted-foreground text-xs">
                    Option {index + 1} of {fields.length}
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                {fields.length < 5 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => addOption(index)}>
                    <Copy /> Duplicate
                  </Button>
                )}
                {fields.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                    <Trash2 /> Remove
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <TextareaField
                name={`options.${index}.description`}
                label="Option description (optional)"
                rows={2}
              />
              <LineItemsEditor
                name={`options.${index}.lines`}
                priceBook={priceBook}
                gstRegistered={gstRegistered}
              />
            </CardContent>
          </Card>
        ))}
        {form.formState.errors.options?.message && (
          <p className="text-destructive text-sm">{form.formState.errors.options.message}</p>
        )}

        {fields.length < 5 && (
          <Button type="button" variant="outline" onClick={() => addOption()}>
            <Plus /> Add option (Good / Better / Best)
          </Button>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Terms</CardTitle>
          </CardHeader>
          <CardContent>
            <TextareaField name="terms" label="Terms and conditions" rows={6} />
          </CardContent>
        </Card>

        <div className="bg-background/95 sticky bottom-0 -mx-3 flex justify-end gap-2 border-t px-3 py-3 md:-mx-6 md:px-6">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <SubmitButton pending={action.pending}>
            {quote ? "Save quote" : "Save draft"}
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
