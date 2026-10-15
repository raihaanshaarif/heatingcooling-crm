import { z } from "zod";
import { dollarsToCents } from "@/lib/money";
import { fromMelbourneInput } from "@/lib/dates";
import { formatPhoneAU, normalisePhone } from "@/lib/utils";

/** Shared Zod building blocks. Forms work with strings; these transform them into DB-ready values. */

export const requiredText = (label: string, max = 200) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max);

export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine(
    (v) => v === null || z.string().email().safeParse(v).success,
    "Enter a valid email address",
  );

/** Australian phone: 8-10 digits (landline without area code, mobile, 1300) or +61. Stored formatted. */
export const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (v === null) return true;
    const digits = normalisePhone(v) ?? "";
    return digits.length >= 8 && digits.length <= 10;
  }, "Enter a valid Australian phone number")
  .transform((v) => (v ? formatPhoneAU(v) : null));

export const postcode = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "Enter a 4-digit postcode");
export const optionalPostcode = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}$/.test(v), "Enter a 4-digit postcode");

export const AU_STATES = ["VIC", "NSW", "QLD", "SA", "WA", "TAS", "ACT", "NT"] as const;
export const stateField = z.enum(AU_STATES).default("VIC");

export const optionalAbn = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v.replace(/\s/g, "") : null))
  .refine((v) => v === null || /^\d{11}$/.test(v), "ABN must be 11 digits")
  .transform((v) =>
    v ? `${v.slice(0, 2)} ${v.slice(2, 5)} ${v.slice(5, 8)} ${v.slice(8)}` : null,
  );

/** Dollar amount typed by a person → integer cents (>= 0). */
export const money = (label = "Amount") =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    if (v === "") return 0;
    const cents = dollarsToCents(v);
    if (Number.isNaN(cents)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a number` });
      return z.NEVER;
    }
    if (cents < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} cannot be negative` });
      return z.NEVER;
    }
    return cents;
  });

export const requiredMoney = (label = "Amount") =>
  money(label).refine((cents) => cents > 0, `${label} must be more than $0`);

export const optionalMoney = (label = "Amount") =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const cents = dollarsToCents(v);
      if (Number.isNaN(cents) || cents < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a positive number`,
        });
        return z.NEVER;
      }
      return cents;
    });

export const quantity = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Quantity must be more than 0" });
    return z.NEVER;
  }
  return Math.round(n * 100) / 100;
});

export const optionalDecimal = (label: string) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a positive number`,
        });
        return z.NEVER;
      }
      return n;
    });

export const optionalInt = (label: string) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a whole number` });
        return z.NEVER;
      }
      return n;
    });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** "yyyy-MM-dd" in Melbourne → Date (or null). */
export const optionalDate = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || DATE_RE.test(v), "Enter a valid date")
  .transform((v) => (v ? fromMelbourneInput(v) : null));

export const requiredDate = (label = "Date") =>
  z
    .string({ required_error: `${label} is required` })
    .regex(DATE_RE, `${label} is required`)
    .transform((v) => fromMelbourneInput(v));

/** "yyyy-MM-ddTHH:mm" in Melbourne → Date (or null). */
export const optionalDateTime = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || DATETIME_RE.test(v), "Enter a valid date and time")
  .transform((v) => (v ? fromMelbourneInput(v) : null));

export const requiredDateTime = (label = "Date") =>
  z
    .string({ required_error: `${label} is required` })
    .regex(DATETIME_RE, `${label} is required`)
    .transform((v) => fromMelbourneInput(v));

export const optionalId = z
  .string()
  .nullish()
  .transform((v) => (v && v !== "none" ? v : null));

export const idList = z.array(z.string().min(1)).default([]);
