import { z } from "zod";
import { LicenceType, Role } from "@prisma/client";
import { money, optionalDate, optionalPhone, optionalText, requiredText } from "./common";

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .regex(/[A-Za-z]/, "Include a letter")
  .regex(/\d/, "Include a number");

export const userSchema = z.object({
  name: requiredText("Name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.nativeEnum(Role),
  phone: optionalPhone,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  hourlyCost: money("Hourly cost"),
  active: z.boolean().default(true),
  password: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(passwordSchema.optional()),
});
export type UserInput = z.input<typeof userSchema>;

export const licenceSchema = z.object({
  userId: z.string().min(1),
  type: z.nativeEnum(LicenceType),
  number: requiredText("Licence number", 100),
  issuedAt: optionalDate,
  expiresAt: optionalDate,
  fileUrl: optionalText(1000),
});
export type LicenceInput = z.input<typeof licenceSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
