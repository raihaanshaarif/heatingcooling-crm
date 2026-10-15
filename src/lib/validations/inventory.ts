import { z } from "zod";
import {
  optionalEmail,
  optionalId,
  optionalMoney,
  optionalPhone,
  optionalText,
  quantity,
  requiredText,
} from "./common";

/** Quantity that may be 0 (a stocktake count, a reorder level). */
const countQty = (label: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    if (v === "") return 0;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be 0 or more` });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

export const supplierSchema = z.object({
  name: requiredText("Name"),
  contact: optionalText(200),
  phone: optionalPhone,
  email: optionalEmail,
  accountNumber: optionalText(50),
  website: optionalText(200),
  notes: optionalText(2000),
  active: z.boolean().default(true),
});
export type SupplierInput = z.input<typeof supplierSchema>;

export const inventoryItemSchema = z.object({
  priceBookItemId: z.string().min(1, "Choose a price book item"),
  reorderLevel: countQty("Reorder level"),
  supplierId: optionalId,
  supplierSku: optionalText(50),
  active: z.boolean().default(true),
});
export type InventoryItemInput = z.input<typeof inventoryItemSchema>;

const stockLine = z.object({
  inventoryItemId: z.string().min(1, "Choose an item"),
  quantity,
});

export const receiveStockSchema = z.object({
  supplierId: optionalId,
  locationId: z.string().min(1, "Choose where it goes"),
  reference: optionalText(100),
  notes: optionalText(1000),
  /** Admin only: also set the price book cost price to the cost paid. */
  updateCostPrice: z.boolean().default(false),
  lines: z
    .array(stockLine.extend({ unitCost: optionalMoney("Unit cost") }))
    .min(1, "Add at least one item"),
});
export type ReceiveStockInput = z.input<typeof receiveStockSchema>;

export const transferStockSchema = z
  .object({
    fromLocationId: z.string().min(1, "Choose where it comes from"),
    toLocationId: z.string().min(1, "Choose where it goes"),
    note: optionalText(500),
    lines: z.array(stockLine).min(1, "Add at least one item"),
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    message: "Choose two different locations",
    path: ["toLocationId"],
  });
export type TransferStockInput = z.input<typeof transferStockSchema>;

export const ADJUST_MODES = ["set", "add", "remove"] as const;

export const adjustStockSchema = z
  .object({
    inventoryItemId: z.string().min(1, "Choose an item"),
    locationId: z.string().min(1, "Choose a location"),
    mode: z.enum(ADJUST_MODES),
    quantity: countQty("Quantity"),
    reason: requiredText("Reason", 100),
    note: optionalText(500),
  })
  .refine((v) => v.mode === "set" || v.quantity > 0, {
    message: "Quantity must be more than 0",
    path: ["quantity"],
  });
export type AdjustStockInput = z.input<typeof adjustStockSchema>;
