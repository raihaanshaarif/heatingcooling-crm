import { describe, expect, it } from "vitest";
import {
  calculateTotals,
  dollarsToCents,
  formatCents,
  gstFromInclusive,
  gstOnCents,
  lineTotalCents,
  marginPercent,
  markupPercent,
  percentChange,
} from "./money";

describe("money", () => {
  it("formats AUD", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(null)).toBe("$0.00");
    expect(formatCents(-500)).toMatch(/-?\$5\.00|\(\$5\.00\)/);
  });

  it("parses dollars into cents without float drift", () => {
    expect(dollarsToCents("1,234.56")).toBe(123456);
    expect(dollarsToCents("$19.99")).toBe(1999);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(dollarsToCents("abc")).toBeNaN();
  });

  it("computes line totals with fractional quantities", () => {
    expect(lineTotalCents(1.5, 12000)).toBe(18000);
    expect(lineTotalCents(3, 333)).toBe(999);
    expect(lineTotalCents(0.333, 1000)).toBe(333);
  });

  it("calculates 10% GST", () => {
    expect(gstOnCents(10000)).toBe(1000);
    expect(gstOnCents(12345)).toBe(1235);
    expect(gstFromInclusive(11000)).toBe(1000);
  });

  it("totals a document with taxable and non-taxable lines", () => {
    const totals = calculateTotals([
      { quantity: 1, unitPriceCents: 18900, taxable: true },
      { quantity: 2, unitPriceCents: 4500, taxable: true },
      { quantity: 1, unitPriceCents: 5000, taxable: false },
    ]);
    expect(totals).toEqual({ subtotalCents: 32900, gstCents: 2790, totalCents: 35690 });
  });

  it("calculates GST once on the taxable sum so rounding never drifts", () => {
    const lines = Array.from({ length: 3 }, () => ({
      quantity: 1,
      unitPriceCents: 333,
      taxable: true,
    }));
    // per-line rounding would give 33 * 3 = 99; summing first gives round(99.9) = 100
    expect(calculateTotals(lines).gstCents).toBe(100);
  });

  it("charges no GST when the business is not registered", () => {
    expect(calculateTotals([{ quantity: 1, unitPriceCents: 10000, taxable: true }], false)).toEqual(
      {
        subtotalCents: 10000,
        gstCents: 0,
        totalCents: 10000,
      },
    );
  });

  it("handles an empty document", () => {
    expect(calculateTotals([])).toEqual({ subtotalCents: 0, gstCents: 0, totalCents: 0 });
  });

  it("calculates margin and markup", () => {
    expect(marginPercent(6000, 10000)).toBe(40);
    expect(markupPercent(6000, 10000)).toBe(66.7);
    expect(marginPercent(100, 0)).toBeNull();
    expect(markupPercent(0, 100)).toBeNull();
  });

  it("calculates percent change", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
  });
});
