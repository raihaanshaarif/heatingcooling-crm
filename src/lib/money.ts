/**
 * All money maths for CoolOps. Amounts are integer cents (AUD).
 * Price book prices and line unit prices are stored EX GST.
 */

export const GST_RATE = 0.1;

const audFormatter = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

export function formatCents(cents: number | null | undefined): string {
  return audFormatter.format((cents ?? 0) / 100);
}

/** "$1,234.50" style without the cents when they are zero, for charts and KPIs. */
export function formatCentsCompact(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: Math.abs(dollars) >= 1000 ? 0 : 2,
  }).format(dollars);
}

/** Parse a dollar amount ("1,234.56", 12.5) into integer cents. Returns NaN for junk. */
export function dollarsToCents(value: string | number): number {
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

/** Line total ex GST for a quantity (may be fractional, e.g. 1.5 hours) times a unit price. */
export function lineTotalCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

export function gstOnCents(exGstCents: number): number {
  return Math.round(exGstCents * GST_RATE);
}

/** GST component of a GST-inclusive amount (1/11th). */
export function gstFromInclusive(incGstCents: number): number {
  return Math.round(incGstCents / 11);
}

export interface MoneyLine {
  quantity: number;
  unitPriceCents: number;
  taxable: boolean;
}

export interface Totals {
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
}

/**
 * Document totals. GST is calculated once on the sum of taxable lines (not per line)
 * so rounding never drifts. When the business is not GST registered GST is zero.
 */
export function calculateTotals(lines: MoneyLine[], gstRegistered = true): Totals {
  let subtotalCents = 0;
  let taxableCents = 0;
  for (const line of lines) {
    const total = lineTotalCents(line.quantity, line.unitPriceCents);
    subtotalCents += total;
    if (line.taxable) taxableCents += total;
  }
  const gstCents = gstRegistered ? gstOnCents(taxableCents) : 0;
  return { subtotalCents, gstCents, totalCents: subtotalCents + gstCents };
}

/** Gross margin % on sell price, e.g. cost 60, price 100 → 40. Null when price is 0. */
export function marginPercent(costCents: number, priceCents: number): number | null {
  if (priceCents <= 0) return null;
  return Math.round(((priceCents - costCents) / priceCents) * 1000) / 10;
}

/** Markup % on cost, e.g. cost 60, price 100 → 66.7. */
export function markupPercent(costCents: number, priceCents: number): number | null {
  if (costCents <= 0) return null;
  return Math.round(((priceCents - costCents) / costCents) * 1000) / 10;
}

export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/** Percentage change between two amounts, rounded to 1dp. Null when there is no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
