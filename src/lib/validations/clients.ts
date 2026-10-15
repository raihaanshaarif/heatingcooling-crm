import { z } from "zod";
import { ClientType, EquipmentType, LeadSource } from "@prisma/client";
import {
  optionalAbn,
  optionalDate,
  optionalDecimal,
  optionalEmail,
  optionalPhone,
  optionalPostcode,
  optionalText,
  postcode,
  requiredText,
  stateField,
} from "./common";

export const clientSchema = z
  .object({
    type: z.nativeEnum(ClientType),
    name: requiredText("Name"),
    companyName: optionalText(200),
    abn: optionalAbn,
    email: optionalEmail,
    phone: optionalPhone,
    altPhone: optionalPhone,
    billingLine1: optionalText(200),
    billingLine2: optionalText(200),
    billingSuburb: optionalText(100),
    billingState: stateField,
    billingPostcode: optionalPostcode,
    notes: optionalText(5000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    source: z
      .nativeEnum(LeadSource)
      .nullish()
      .transform((v) => v ?? null),
    doNotService: z.boolean().default(false),
    /** On create: also add the billing address as the first service property. */
    createPropertyFromBilling: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (
      v.createPropertyFromBilling &&
      (!v.billingLine1 || !v.billingSuburb || !v.billingPostcode)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["billingLine1"],
        message: "Enter the full address to use it as a property",
      });
    }
  });
export type ClientInput = z.input<typeof clientSchema>;

export const contactSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1),
  name: requiredText("Name"),
  role: optionalText(100),
  phone: optionalPhone,
  email: optionalEmail,
  isPrimary: z.boolean().default(false),
});
export type ContactInput = z.input<typeof contactSchema>;

export const propertySchema = z.object({
  clientId: z.string().min(1),
  label: optionalText(100),
  addressLine1: requiredText("Street address"),
  addressLine2: optionalText(200),
  suburb: requiredText("Suburb", 100),
  state: stateField,
  postcode,
  accessNotes: optionalText(2000),
  parkingNotes: optionalText(1000),
  petNotes: optionalText(1000),
  keyInfo: optionalText(1000),
});
export type PropertyInput = z.input<typeof propertySchema>;

export const equipmentSchema = z.object({
  propertyId: z.string().min(1, "Choose a property"),
  type: z.nativeEnum(EquipmentType),
  brand: requiredText("Brand", 100),
  model: optionalText(100),
  serialNumber: optionalText(100),
  indoorModel: optionalText(100),
  outdoorModel: optionalText(100),
  capacityKw: optionalDecimal("Capacity"),
  refrigerant: optionalText(20),
  location: optionalText(100),
  installDate: optionalDate,
  installedByUs: z.boolean().default(false),
  warrantyExpiresAt: optionalDate,
  notes: optionalText(5000),
});
export type EquipmentInput = z.input<typeof equipmentSchema>;
