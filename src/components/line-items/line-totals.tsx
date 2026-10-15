import { calculateTotals, dollarsToCents, formatCents } from "@/lib/money";

export interface EditableLine {
  quantity?: string | number;
  unitPrice?: string | number;
  taxable?: boolean;
}

export function parseLines(lines: EditableLine[] | undefined) {
  return (lines ?? []).map((l) => {
    const quantity = Number(l.quantity);
    const cents = dollarsToCents(l.unitPrice ?? 0);
    return {
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unitPriceCents: Number.isFinite(cents) ? cents : 0,
      taxable: l.taxable ?? true,
    };
  });
}

/** Live subtotal / GST / total box for editable line items. */
export function LineTotals({
  lines,
  gstRegistered,
}: {
  lines: EditableLine[] | undefined;
  gstRegistered: boolean;
}) {
  const totals = calculateTotals(parseLines(lines), gstRegistered);
  return (
    <dl className="ml-auto grid w-full max-w-64 grid-cols-2 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Subtotal (ex GST)</dt>
      <dd className="text-right tabular-nums">{formatCents(totals.subtotalCents)}</dd>
      {gstRegistered && (
        <>
          <dt className="text-muted-foreground">GST 10%</dt>
          <dd className="text-right tabular-nums">{formatCents(totals.gstCents)}</dd>
        </>
      )}
      <dt className="border-t pt-1 font-semibold">Total{gstRegistered ? " inc GST" : ""}</dt>
      <dd className="border-t pt-1 text-right font-semibold tabular-nums">
        {formatCents(totals.totalCents)}
      </dd>
    </dl>
  );
}
