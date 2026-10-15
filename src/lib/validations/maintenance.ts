import { z } from "zod";
import { PlanFrequency } from "@prisma/client";
import { idList, money, optionalId, optionalText, requiredDate, requiredText } from "./common";

export const maintenancePlanSchema = z.object({
  clientId: z.string().min(1, "Choose a client"),
  propertyId: optionalId,
  name: requiredText("Plan name"),
  frequency: z.nativeEnum(PlanFrequency),
  price: money("Price"),
  startDate: requiredDate("Start date"),
  nextDueDate: requiredDate("Next due date"),
  active: z.boolean().default(true),
  notes: optionalText(5000),
  equipmentIds: idList,
});
export type MaintenancePlanInput = z.input<typeof maintenancePlanSchema>;
