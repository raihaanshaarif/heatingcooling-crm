"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ItemType } from "@prisma/client";
import { PackageMinus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import { PriceBookPicker } from "@/components/line-items/price-book-picker";
import { ITEM_TYPE_LABELS, options } from "@/lib/labels";
import { calculateTotals, formatCents, lineTotalCents, marginPercent } from "@/lib/money";
import { addJobLineItem, deleteJobLineItem } from "@/server/jobs/actions";
import { deductJobLineStock } from "@/server/inventory/actions";
import type { PriceBookPickerItem } from "@/server/price-book/queries";

export interface JobLine {
  id: string;
  type: ItemType;
  description: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  taxable: boolean;
  /** Stock location the part was taken from, when it came out of inventory. */
  stockSource?: string | null;
  /** A tracked part that hasn't been taken from stock yet (e.g. copied from a quote). */
  canTakeFromStock?: boolean;
}

/**
 * Labour and parts used on a job. Technicians add items from the price book and
 * never see prices; the office sees prices, and admins also see cost and margin.
 * Parts tracked in inventory are taken from the technician's van automatically and
 * go back when the line is removed.
 */
export function JobLineItems({
  jobId,
  lines,
  priceBook,
  showPrices,
  showCosts,
  gstRegistered,
  readOnly,
  canMoveStock = false,
}: {
  jobId: string;
  lines: JobLine[];
  priceBook: PriceBookPickerItem[];
  showPrices: boolean;
  showCosts: boolean;
  gstRegistered: boolean;
  readOnly?: boolean;
  /** Office / admin: offer "Take from stock" on tracked lines not yet deducted. */
  canMoveStock?: boolean;
}) {
  const router = useRouter();
  const add = useAction(addJobLineItem, {
    successMessage: (d) =>
      d.negativeStock ? "" : d.stockMessage ? `Added to job. ${d.stockMessage}` : "Added to job",
    onSuccess: (d) => {
      if (d.negativeStock && d.stockMessage) toast.warning(`Added to job. ${d.stockMessage}`);
      router.refresh();
    },
  });
  const remove = useAction(deleteJobLineItem, {
    successMessage: (d) => d.stockMessage ?? "",
    onSuccess: () => router.refresh(),
  });
  const takeFromStock = useAction(deductJobLineStock, {
    successMessage: (d) => (d.negative ? "" : (d.message ?? "Taken from stock")),
    onSuccess: (d) => {
      if (d.negative && d.message) toast.warning(d.message);
      router.refresh();
    },
  });
  const totals = calculateTotals(lines, gstRegistered);
  const cost = lines.reduce((s, l) => s + lineTotalCents(l.quantity, l.unitCostCents), 0);
  const margin = marginPercent(cost, totals.subtotalCents);

  const addFromBook = (item: PriceBookPickerItem) =>
    void add.run({
      jobId,
      priceBookItemId: item.id,
      type: item.type,
      description: item.name,
      quantity: "1",
      unitPrice: (item.priceCents / 100).toFixed(2),
      taxable: item.taxable,
    });

  return (
    <div className="space-y-3">
      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">No labour or parts recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                {showPrices && <TableHead className="text-right">Unit</TableHead>}
                {showCosts && <TableHead className="text-right">Cost</TableHead>}
                {showPrices && <TableHead className="text-right">Amount</TableHead>}
                {!readOnly && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="pl-3 whitespace-normal">
                    {l.description}
                    <span className="text-muted-foreground block text-xs">
                      {ITEM_TYPE_LABELS[l.type]}
                      {l.stockSource && ` · from ${l.stockSource}`}
                    </span>
                    {!readOnly && canMoveStock && l.canTakeFromStock && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        disabled={takeFromStock.pending}
                        onClick={() => void takeFromStock.run({ id: l.id })}
                      >
                        <PackageMinus className="size-3" /> Take from stock
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                  {showPrices && (
                    <TableCell className="text-right tabular-nums">
                      {formatCents(l.unitPriceCents)}
                    </TableCell>
                  )}
                  {showCosts && (
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {formatCents(l.unitCostCents)}
                    </TableCell>
                  )}
                  {showPrices && (
                    <TableCell className="text-right tabular-nums">
                      {formatCents(lineTotalCents(l.quantity, l.unitPriceCents))}
                    </TableCell>
                  )}
                  {!readOnly && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={remove.pending}
                        onClick={() => void remove.run({ id: l.id })}
                        aria-label="Remove"
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
            {showPrices && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={showCosts ? 4 : 3} className="text-right">
                    Subtotal{gstRegistered ? ` · GST ${formatCents(totals.gstCents)}` : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(totals.subtotalCents)}
                  </TableCell>
                  {!readOnly && <TableCell />}
                </TableRow>
                {showCosts && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-right">
                      Cost {formatCents(cost)} · Gross profit
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(totals.subtotalCents - cost)}
                      {margin !== null && (
                        <span className="text-muted-foreground block text-xs">
                          {margin.toFixed(0)}% margin
                        </span>
                      )}
                    </TableCell>
                    {!readOnly && <TableCell />}
                  </TableRow>
                )}
              </TableFooter>
            )}
          </Table>
        </div>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <PriceBookPicker
            items={priceBook}
            onPick={addFromBook}
            hidePrices={!showPrices}
            label="Add part / labour"
          />
          {showPrices && (
            <FormDialog
              title="Add custom line"
              trigger={
                <Button variant="outline" size="sm">
                  <Plus /> Custom line
                </Button>
              }
            >
              {(close) => <CustomLineForm jobId={jobId} showCosts={showCosts} onDone={close} />}
            </FormDialog>
          )}
        </div>
      )}
    </div>
  );
}

function CustomLineForm({
  jobId,
  showCosts,
  onDone,
}: {
  jobId: string;
  showCosts: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<ItemType>("PART");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [taxable, setTaxable] = useState(true);
  const action = useAction(addJobLineItem, {
    successMessage: "Line added",
    onSuccess: () => {
      onDone();
      router.refresh();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run({
          jobId,
          type,
          description,
          quantity,
          unitPrice,
          unitCost: showCosts && unitCost ? unitCost : undefined,
          taxable,
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as ItemType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options(ITEM_TYPE_LABELS).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cl-qty">Quantity</Label>
          <Input
            id="cl-qty"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="cl-desc">Description</Label>
          <Input
            id="cl-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cl-price">Unit price ex GST ($)</Label>
          <Input
            id="cl-price"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            inputMode="decimal"
          />
        </div>
        {showCosts && (
          <div className="space-y-2">
            <Label htmlFor="cl-cost">Unit cost ($)</Label>
            <Input
              id="cl-cost"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              inputMode="decimal"
            />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={taxable} onCheckedChange={(v) => setTaxable(v === true)} /> GST applies
        </label>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={action.pending || !description.trim()}>
          Add line
        </Button>
      </div>
    </form>
  );
}
