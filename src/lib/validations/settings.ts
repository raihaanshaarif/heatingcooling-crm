import { z } from "zod";
import { JobType, PaymentTerms, ServiceCategory } from "@prisma/client";
import {
  optionalAbn,
  optionalEmail,
  optionalPhone,
  optionalPostcode,
  optionalText,
  requiredText,
  stateField,
} from "./common";

export const businessSettingsSchema = z.object({
  businessName: requiredText("Business name"),
  tradingName: optionalText(200),
  abn: optionalAbn,
  email: optionalEmail,
  phone: optionalPhone,
  website: optionalText(200),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  suburb: optionalText(100),
  state: stateField,
  postcode: optionalPostcode,
});
export type BusinessSettingsInput = z.input<typeof businessSettingsSchema>;

export const invoicingSettingsSchema = z.object({
  gstRegistered: z.boolean(),
  defaultPaymentTerms: z.nativeEnum(PaymentTerms),
  quoteValidityDays: z.coerce.number().int().min(1).max(365),
  bankName: optionalText(100),
  bsb: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v.replace(/\D/g, "") : null))
    .refine((v) => v === null || /^\d{6}$/.test(v), "BSB must be 6 digits")
    .transform((v) => (v ? `${v.slice(0, 3)}-${v.slice(3)}` : null)),
  accountNumber: optionalText(20),
  accountName: optionalText(200),
  invoiceFooter: optionalText(5000),
  quoteTerms: optionalText(10000),
});
export type InvoicingSettingsInput = z.input<typeof invoicingSettingsSchema>;

const prefix = z
  .string()
  .trim()
  .min(1, "Required")
  .max(10)
  .regex(/^[A-Za-z0-9]+$/, "Letters and numbers only");

export const numberingSettingsSchema = z.object({
  quotePrefix: prefix,
  jobPrefix: prefix,
  invoicePrefix: prefix,
  creditNotePrefix: prefix,
});
export type NumberingSettingsInput = z.input<typeof numberingSettingsSchema>;

export const EMAIL_TEMPLATE_KEYS = [
  "quoteSent",
  "invoiceSent",
  "invoiceOverdue",
  "serviceDue",
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export const emailTemplatesSchema = z.object(
  Object.fromEntries(
    EMAIL_TEMPLATE_KEYS.map((k) => [
      k,
      z.object({ subject: z.string().trim().max(200), body: z.string().trim().max(5000) }),
    ]),
  ) as Record<EmailTemplateKey, z.ZodObject<{ subject: z.ZodString; body: z.ZodString }>>,
);
export type EmailTemplatesInput = z.input<typeof emailTemplatesSchema>;

export const checklistTemplateSchema = z.object({
  id: z.string().optional(),
  name: requiredText("Name"),
  jobType: z
    .nativeEnum(JobType)
    .nullish()
    .transform((v) => v ?? null),
  serviceCategory: z
    .nativeEnum(ServiceCategory)
    .nullish()
    .transform((v) => v ?? null),
  items: z
    .string()
    .transform((v) =>
      v
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    )
    .refine((items) => items.length > 0, "Add at least one item (one per line)"),
  active: z.boolean().default(true),
});
export type ChecklistTemplateInput = z.input<typeof checklistTemplateSchema>;

/** SMS templates. The first four are sent automatically (each can be switched off); the rest are for one-off texts. */
export const SMS_AUTO_KEYS = [
  "onMyWay",
  "appointmentReminder",
  "serviceDue",
  "invoiceOverdue",
] as const;
export type SmsAutoKey = (typeof SMS_AUTO_KEYS)[number];
export const SMS_TEMPLATE_KEYS = [...SMS_AUTO_KEYS, "runningLate", "general"] as const;
export type SmsTemplateKey = (typeof SMS_TEMPLATE_KEYS)[number];

export const SMS_MAX_LENGTH = 612; // 4 segments of GSM-7: long enough, short enough to stop accidents

const smsBody = z
  .string()
  .trim()
  .min(1, "Template can't be empty")
  .max(SMS_MAX_LENGTH, `Keep it under ${SMS_MAX_LENGTH} characters`);

export const smsSettingsSchema = z.object({
  enabled: z.object(
    Object.fromEntries(SMS_AUTO_KEYS.map((k) => [k, z.boolean()])) as Record<
      SmsAutoKey,
      z.ZodBoolean
    >,
  ),
  templates: z.object(
    Object.fromEntries(SMS_TEMPLATE_KEYS.map((k) => [k, smsBody])) as Record<
      SmsTemplateKey,
      typeof smsBody
    >,
  ),
});
export type SmsSettingsInput = z.input<typeof smsSettingsSchema>;
export type SmsSettings = z.output<typeof smsSettingsSchema>;

export const sendSmsSchema = z.object({
  clientId: z.string().min(1),
  jobId: z.string().min(1).nullish(),
  body: z
    .string()
    .trim()
    .min(1, "Write a message")
    .max(SMS_MAX_LENGTH, `Keep it under ${SMS_MAX_LENGTH} characters`),
});
export type SendSmsInput = z.input<typeof sendSmsSchema>;

// ─── Xero ────────────────────────────────────────────────────────────────────

const xeroCode = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(50)
    .regex(/^[A-Za-z0-9_.-]+$/, "Letters, numbers, dots, dashes and underscores only");

export const XERO_INVOICE_STATUSES = ["AUTHORISED", "DRAFT"] as const;

export const xeroSettingsSchema = z.object({
  salesAccountCode: xeroCode("Sales account code"),
  taxTypeTaxable: xeroCode("Tax rate for GST lines"),
  taxTypeFree: xeroCode("Tax rate for GST-free lines"),
  /** Picked from Xero's bank accounts (AccountID); the code is the fallback when typed in. */
  bankAccountId: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((v) => v || null),
  bankAccountCode: z
    .string()
    .trim()
    .max(50)
    .nullish()
    .transform((v) => v || null),
  bankAccountName: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  invoiceStatus: z.enum(XERO_INVOICE_STATUSES),
  autoSync: z.boolean(),
});
export type XeroSettingsInput = z.input<typeof xeroSettingsSchema>;
export type XeroSettings = z.output<typeof xeroSettingsSchema>;

export const xeroTenantSchema = z.object({ tenantId: z.string().trim().min(1).max(100) });
