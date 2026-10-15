import { z } from "zod";
import { money, optionalDate, optionalId, optionalText, quantity, requiredText } from "./common";

export const lineItemSchema = z.object({
  priceBookItemId: optionalId,
  description: requiredText("Description", 1000),
  quantity,
  unitPrice: money("Unit price"),
  taxable: z.boolean().default(true),
});
export type LineItemInput = z.input<typeof lineItemSchema>;

export const quoteOptionSchema = z.object({
  name: requiredText("Option name", 100),
  description: optionalText(2000),
  lines: z.array(lineItemSchema).min(1, "Add at least one line item"),
});

export const quoteSchema = z.object({
  clientId: z.string().min(1, "Choose a client"),
  propertyId: optionalId,
  leadId: optionalId,
  title: requiredText("Title"),
  intro: optionalText(5000),
  terms: optionalText(10000),
  validUntil: optionalDate,
  options: z.array(quoteOptionSchema).min(1, "Add at least one option").max(5, "Up to 5 options"),
});
export type QuoteInput = z.input<typeof quoteSchema>;

export const quoteDecisionSchema = z.object({
  token: z.string().min(1),
  optionId: z.string().min(1).optional(),
  signedName: z.string().trim().min(1, "Type your name to accept").max(200).optional(),
  reason: z.string().trim().max(2000).optional(),
});

export const acceptQuoteSchema = z.object({
  id: z.string().min(1),
  optionId: z.string().min(1, "Choose an option"),
});
