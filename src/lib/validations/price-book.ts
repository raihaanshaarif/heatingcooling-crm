import { z } from "zod";
import { ItemType, ServiceCategory } from "@prisma/client";
import { money, optionalText, requiredText } from "./common";

export const priceBookItemSchema = z.object({
  sku: optionalText(50),
  name: requiredText("Name"),
  description: optionalText(2000),
  type: z.nativeEnum(ItemType),
  category: z.nativeEnum(ServiceCategory),
  unit: requiredText("Unit", 30),
  cost: money("Cost"),
  price: money("Price"),
  taxable: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type PriceBookItemInput = z.input<typeof priceBookItemSchema>;
