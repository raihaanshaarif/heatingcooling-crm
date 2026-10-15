import { z } from "zod";
import { ClientType, LeadSource, LeadStatus, Priority, ServiceCategory } from "@prisma/client";
import {
  optionalDate,
  optionalEmail,
  optionalId,
  optionalMoney,
  optionalPhone,
  optionalPostcode,
  optionalText,
  requiredText,
  stateField,
} from "./common";

export const leadSchema = z
  .object({
    name: requiredText("Name"),
    email: optionalEmail,
    phone: optionalPhone,
    suburb: optionalText(100),
    postcode: optionalPostcode,
    status: z.nativeEnum(LeadStatus).default("NEW"),
    source: z.nativeEnum(LeadSource),
    sourceDetail: optionalText(200),
    serviceCategory: z
      .nativeEnum(ServiceCategory)
      .nullish()
      .transform((v) => v ?? null),
    brand: optionalText(100),
    message: optionalText(5000),
    urgency: z.nativeEnum(Priority).default("NORMAL"),
    estimatedValue: optionalMoney("Estimated value"),
    assignedToId: optionalId,
    followUpAt: optionalDate,
  })
  .refine((v) => v.email || v.phone, { message: "Enter a phone number or email", path: ["phone"] });
export type LeadInput = z.input<typeof leadSchema>;

export const leadStatusSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(LeadStatus),
});

export const markLostSchema = z.object({
  id: z.string().min(1),
  lostReason: requiredText("Reason", 200),
  note: optionalText(2000),
});

export const leadNoteSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["NOTE", "CALL", "EMAIL", "SMS"]),
  body: requiredText("Note", 5000),
});

export const followUpSchema = z.object({
  id: z.string().min(1),
  followUpAt: optionalDate,
});

export const convertLeadSchema = z
  .object({
    id: z.string().min(1),
    existingClientId: optionalId,
    clientType: z.nativeEnum(ClientType).default("RESIDENTIAL"),
    addressLine1: optionalText(200),
    suburb: optionalText(100),
    state: stateField,
    postcode: optionalPostcode,
    next: z.enum(["none", "quote", "job"]).default("none"),
  })
  .superRefine((v, ctx) => {
    if (!v.existingClientId) {
      if (!v.addressLine1)
        ctx.addIssue({
          code: "custom",
          path: ["addressLine1"],
          message: "Street address is required",
        });
      if (!v.suburb)
        ctx.addIssue({ code: "custom", path: ["suburb"], message: "Suburb is required" });
      if (!v.postcode)
        ctx.addIssue({ code: "custom", path: ["postcode"], message: "Postcode is required" });
    }
  });
export type ConvertLeadInput = z.input<typeof convertLeadSchema>;

/** Payload posted by the website contact form to /api/leads/webhook. */
export const webhookLeadSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().toLowerCase().email().max(200).optional().or(z.literal("")),
    phone: z.string().trim().max(30).optional().or(z.literal("")),
    suburb: z.string().trim().max(100).optional(),
    postcode: z
      .string()
      .trim()
      .regex(/^\d{4}$/)
      .optional()
      .or(z.literal("")),
    service: z.string().trim().max(100).optional(),
    brand: z.string().trim().max(100).optional(),
    message: z.string().trim().max(5000).optional(),
    utm_source: z.string().trim().max(200).optional(),
    utm_medium: z.string().trim().max(200).optional(),
    utm_campaign: z.string().trim().max(200).optional(),
    gclid: z.string().trim().max(500).optional(),
    // Which of your websites sent it, e.g. "coolingservicemelbourne.com.au".
    site: z.string().trim().max(150).optional(),
    // Honeypot field: real people leave it empty, bots fill it in.
    website: z.string().optional(),
  })
  .refine((v) => !!v.email || !!v.phone, {
    message: "email or phone is required",
    path: ["email"],
  });
export type WebhookLeadInput = z.infer<typeof webhookLeadSchema>;

/** Map free-text service names from the website form onto our categories. */
export function mapServiceCategory(service: string | undefined): ServiceCategory | null {
  if (!service) return null;
  const s = service.toLowerCase();
  if (s.includes("emergency") || s.includes("urgent") || s.includes("breakdown"))
    return "EMERGENCY_REPAIR";
  if (s.includes("evap")) return "EVAPORATIVE";
  if (s.includes("duct")) return "DUCTED";
  if (
    s.includes("split") ||
    s.includes("reverse cycle") ||
    s.includes("air con") ||
    s.includes("aircon")
  )
    return "SPLIT_SYSTEM";
  if (s.includes("gas") || s.includes("heater") || s.includes("heating") || s.includes("furnace"))
    return "GAS_HEATING";
  if (s.includes("heat pump") || s.includes("hot water")) return "HEAT_PUMP";
  if (s.includes("commercial")) return "COMMERCIAL_HVAC";
  if (s.includes("service") || s.includes("maint") || s.includes("clean")) return "MAINTENANCE";
  const upper = service.toUpperCase().replace(/[\s-]+/g, "_");
  return (Object.values(ServiceCategory) as string[]).includes(upper)
    ? (upper as ServiceCategory)
    : "OTHER";
}
