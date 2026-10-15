import "server-only";
import { calculateTotals, lineTotalCents } from "@/lib/money";
import type { Tx } from "@/lib/db";
import type { z } from "zod";
import type { quoteOptionSchema } from "@/lib/validations/quotes";

type OptionInput = z.output<typeof quoteOptionSchema>;

/** Replace all options + lines on a quote and recalculate totals. Returns the quote totals (first or selected option). */
export async function writeQuoteOptions(
  tx: Tx,
  quoteId: string,
  options: OptionInput[],
  gstRegistered: boolean,
  selectedIndex = 0,
) {
  await tx.quoteOption.deleteMany({ where: { quoteId } });
  const created: { id: string; subtotalCents: number; gstCents: number; totalCents: number }[] = [];
  for (const [i, option] of options.entries()) {
    const totals = calculateTotals(
      option.lines.map((l) => ({
        quantity: l.quantity,
        unitPriceCents: l.unitPrice,
        taxable: l.taxable,
      })),
      gstRegistered,
    );
    const row = await tx.quoteOption.create({
      data: {
        quoteId,
        name: option.name,
        description: option.description,
        sortOrder: i,
        ...totals,
        lineItems: {
          create: option.lines.map((l, j) => ({
            priceBookItemId: l.priceBookItemId,
            description: l.description,
            quantity: l.quantity,
            unitPriceCents: l.unitPrice,
            taxable: l.taxable,
            totalCents: lineTotalCents(l.quantity, l.unitPrice),
            sortOrder: j,
          })),
        },
      },
    });
    created.push({ id: row.id, ...totals });
  }
  const headline = created[selectedIndex] ?? created[0];
  return {
    options: created,
    totals: {
      subtotalCents: headline?.subtotalCents ?? 0,
      gstCents: headline?.gstCents ?? 0,
      totalCents: headline?.totalCents ?? 0,
    },
  };
}
